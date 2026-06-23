import * as fs from 'fs'
import { splitMarkdownBlocks } from './markdown-blocks'
import type { ReplayActivity } from './types'

/**
 * The golden is a single hand-editable Markdown file per fixture (`golden.md`).
 * It is *scaffolded* from the producer's segmentation (real boundaries, blank
 * summaries — no LLM), then the user edits it to express the target: write each
 * summary to the ideal, and fix the boundaries by merging/splitting blocks.
 *
 * Eval then compares a fresh replay against it on two axes:
 *   - segmentation: are the activities cut at the same boundaries? (time overlap)
 *   - summary: does each candidate mean the same as the golden? (LLM equivalence)
 *
 * Format (one `## ` block per activity, blocks separated by `---`):
 *
 *   # Golden — <fixture>
 *
 *   ## 1. Code — auth.ts
 *   0:00 → 1:30 · Code
 *
 *   Stepped through the auth middleware in the debugger and inspected headers.
 *
 *   ---
 *
 *   ## 2. Chrome — github.com
 *   1:30 → 2:10 · Chrome · github.com
 *
 *   Reviewed the open PR's diff for the token-refresh change.
 *
 * Times are mm:ss from session start. The `· App · tld` label after the range is
 * a human-facing scanning aid (app name, then domain when it's a web activity);
 * it's reconstructed from the producer, not authoritative — appName/windowTitle
 * are read from the `## ` header. The leading number in the header is for humans
 * only — matching is by time overlap, not index.
 */

export interface GoldenActivity {
  /** 1-based, human-facing only. */
  index: number
  appName: string
  windowTitle?: string
  /** Domain of a web activity, recovered from the time-line `· App · tld` label. */
  tld?: string
  startOffsetMs: number
  endOffsetMs: number
  /**
   * `true` when this block is a `DROPPED` marker, not a summary: the pipeline is
   * expected to drop (not emit) an activity in this span. A produced activity
   * overlapping it is a scoring violation. `summary` holds the drop note.
   */
  dropped?: boolean
  summary: string
}

export const HEADER_RE = /^##\s+(?:(\d+)\.\s*)?(.+?)(?:\s+—\s+(.+))?\s*$/
// The optional trailing group is the `· App · tld` scanning label (or a bare
// `· App`); older goldens have none. It's captured but appName is taken from the
// header, so the label is advisory.
export const TIME_RE = /^\s*(\d+):(\d{2})\s*(?:->|→)\s*(\d+):(\d{2})\s*(?:·(.*))?$/

export function formatOffset(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * The single source of truth for a golden block's time line:
 * `mm:ss → mm:ss · App[ · tld]`. Shared by the scaffold renderer and the
 * tld backfill so both emit byte-identical lines.
 */
export function formatTimeLine(
  startOffsetMs: number,
  endOffsetMs: number,
  appName: string,
  tld?: string,
): string {
  const label = tld ? `${appName} · ${tld}` : appName
  return `${formatOffset(startOffsetMs)} → ${formatOffset(endOffsetMs)} · ${label}`
}

/** Pulls the `tld` out of a time-line label (`App · tld` → `tld`; `App` → none). */
function parseTldFromLabel(label: string | undefined): string | undefined {
  if (!label) return undefined
  const segs = label
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean)
  return segs.length >= 2 ? segs[segs.length - 1] : undefined
}

function parseOffset(min: string, sec: string): number {
  return (parseInt(min, 10) * 60 + parseInt(sec, 10)) * 1000
}

/** Renders a golden.md scaffold from a replay's activities (summaries left blank
 *  when no LLM ran, so the user fills them in). */
export function renderGoldenMd(
  fixture: string,
  activities: ReplayActivity[],
  sessionStartMs?: number,
): string {
  const sorted = [...activities].sort((a, b) => a.startTimestamp - b.startTimestamp)
  // Anchor to the session.mp4 clock (min frame ts) so mm:ss lines up with the
  // review video; fall back to the first block when no zero is supplied.
  const sessionStart = sessionStartMs ?? (sorted.length ? sorted[0].startTimestamp : 0)

  const lines: string[] = []
  lines.push(`# Golden — ${fixture}`)
  lines.push('')

  sorted.forEach((act, i) => {
    const title = act.windowTitle ? ` — ${act.windowTitle}` : ''
    lines.push(`## ${i + 1}. ${act.appName}${title}`)
    lines.push(
      formatTimeLine(
        act.startTimestamp - sessionStart,
        act.endTimestamp - sessionStart,
        act.appName,
        act.tld,
      ),
    )
    lines.push('')
    if (act.dropped) {
      lines.push(`DROPPED — ${act.dropped.reason}: ${act.dropped.detail}`)
    } else {
      lines.push(act.summary || '_(no summary produced — fill in the target)_')
    }
    lines.push('')
    if (i < sorted.length - 1) {
      lines.push('---')
      lines.push('')
    }
  })

  return lines.join('\n')
}

/** Parses a golden.md back into structured activities. Lenient on whitespace. */
export function parseGoldenMd(text: string): GoldenActivity[] {
  const out: GoldenActivity[] = []
  for (const block of splitMarkdownBlocks(text, HEADER_RE)) {
    const headerMatch = block[0].match(HEADER_RE)
    if (!headerMatch) continue
    const appName = headerMatch[2].trim()
    const windowTitle = headerMatch[3]?.trim() || undefined

    // Find the time line, then everything after it (until `---`) is the summary.
    let startOffsetMs = 0
    let endOffsetMs = 0
    let tld: string | undefined
    let timeLineIdx = -1
    for (let i = 1; i < block.length; i++) {
      const tm = block[i].match(TIME_RE)
      if (tm) {
        startOffsetMs = parseOffset(tm[1], tm[2])
        endOffsetMs = parseOffset(tm[3], tm[4])
        tld = parseTldFromLabel(tm[5])
        timeLineIdx = i
        break
      }
    }
    if (timeLineIdx === -1) continue

    const summaryLines: string[] = []
    for (let i = timeLineIdx + 1; i < block.length; i++) {
      if (block[i].trim() === '---') break
      summaryLines.push(block[i])
    }
    const summary = summaryLines.join('\n').trim()
    const dropped = /^DROPPED\b/i.test(summary)

    out.push({
      index: out.length + 1,
      appName,
      windowTitle,
      tld,
      startOffsetMs,
      endOffsetMs,
      dropped: dropped || undefined,
      summary,
    })
  }

  return out
}

export function loadGoldenMd(filePath: string): GoldenActivity[] | null {
  if (!fs.existsSync(filePath)) return null
  return parseGoldenMd(fs.readFileSync(filePath, 'utf8'))
}

// --------------------------------------------------------------------------
// Segmentation matching
// --------------------------------------------------------------------------

export interface SegmentMatchable {
  activityId: string
  /** Offset from session start, ms. */
  startOffsetMs: number
  endOffsetMs: number
  windowTitle?: string
}

export interface SegmentMatch {
  goldenIndex: number
  activityId: string
  overlapRatio: number
}

export interface SegmentationReport {
  matches: SegmentMatch[]
  /** Goldens with no produced activity (we merged/missed a boundary). */
  unmatchedGoldenIndexes: number[]
  /** Produced activities with no golden (we over-split). */
  unmatchedActivityIds: string[]
  /** matches / golden count, 0..1. */
  coverage: number
}

export const DEFAULT_MIN_OVERLAP_RATIO = 0.3

/** Greedy best-overlap match of produced activities to golden segments. */
export function matchSegments(params: {
  activities: SegmentMatchable[]
  goldens: GoldenActivity[]
  minOverlapRatio?: number
}): SegmentationReport {
  const minRatio = params.minOverlapRatio ?? DEFAULT_MIN_OVERLAP_RATIO

  interface Pair {
    goldenIndex: number
    activityId: string
    ratio: number
    titleMatch: number
  }
  const pairs: Pair[] = []
  for (const g of params.goldens) {
    for (const a of params.activities) {
      const overlap = Math.max(
        0,
        Math.min(a.endOffsetMs, g.endOffsetMs) - Math.max(a.startOffsetMs, g.startOffsetMs),
      )
      if (overlap <= 0) continue
      const aDur = Math.max(1, a.endOffsetMs - a.startOffsetMs)
      const gDur = Math.max(1, g.endOffsetMs - g.startOffsetMs)
      const ratio = overlap / Math.min(aDur, gDur)
      if (ratio < minRatio) continue
      const titleMatch = g.windowTitle && a.windowTitle && g.windowTitle === a.windowTitle ? 1 : 0
      pairs.push({ goldenIndex: g.index, activityId: a.activityId, ratio, titleMatch })
    }
  }

  pairs.sort((x, y) => y.ratio - x.ratio || y.titleMatch - x.titleMatch)
  const usedGolden = new Set<number>()
  const usedActivity = new Set<string>()
  const matches: SegmentMatch[] = []
  for (const p of pairs) {
    if (usedGolden.has(p.goldenIndex) || usedActivity.has(p.activityId)) continue
    usedGolden.add(p.goldenIndex)
    usedActivity.add(p.activityId)
    matches.push({
      goldenIndex: p.goldenIndex,
      activityId: p.activityId,
      overlapRatio: Math.round(p.ratio * 100) / 100,
    })
  }

  return {
    matches,
    unmatchedGoldenIndexes: params.goldens
      .filter((g) => !usedGolden.has(g.index))
      .map((g) => g.index),
    unmatchedActivityIds: params.activities
      .filter((a) => !usedActivity.has(a.activityId))
      .map((a) => a.activityId),
    coverage: params.goldens.length ? matches.length / params.goldens.length : 1,
  }
}
