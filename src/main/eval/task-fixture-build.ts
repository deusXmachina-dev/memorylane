/**
 * Shared helpers for turning real activities into a task-mining fixture.
 *
 * Used by both the `export-day` CLI (a whole day) and the in-app Tasks tab
 * (a single sighting + a noise window around it). The on-disk shape is the same
 * either way: `TaskFixtureActivity[]` (→ activities.jsonl) plus a `golden.md`.
 */

import type { StorageService } from '../storage'
import type { StoredActivity } from '../storage/types'
import type { GoldenActivity } from './golden-md'
import type { TaskFixtureActivity } from './task-types'

const DAY_MS = 24 * 60 * 60 * 1000

/** Local midnight (ms) of the day containing `ts`. */
export function localMidnight(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** YYYY-MM-DD for a local-midnight timestamp. */
export function dayString(dayStart: number): string {
  const d = new Date(dayStart)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Freeze a stored activity into a fixture row. `offsetMin` is from `dayStart`. */
export function toFixtureActivity(s: StoredActivity, dayStart: number): TaskFixtureActivity {
  return {
    id: s.id,
    // Preserve real time-of-day so spacing/order matches the recorded day.
    offsetMin: Math.round((s.startTimestamp - dayStart) / 60_000),
    durationMin: Math.max(1, Math.round((s.endTimestamp - s.startTimestamp) / 60_000)),
    app: s.appName,
    windowTitle: s.windowTitle,
    tld: s.tld,
    summary: s.summary,
    ocrText: s.ocrText,
  }
}

export interface WindowedActivities {
  activities: TaskFixtureActivity[]
  dayStart: number
  windowFrom: number
  windowTo: number
}

/**
 * Builds the fixture activity set for a sighting: every activity within
 * `[span − beforeMin, span + afterMin]` (the span is the sighting's own
 * activities), padded into a noise window the miner must discriminate against.
 *
 * The window is clamped to the sighting day's local-midnight bounds — the miner
 * scans one day, so a fixture never spans two. `offsetMin` is relative to that
 * midnight, matching `seedFixtureDb` in `task-replay.ts`.
 */
export function buildWindowedActivities(
  storage: StorageService,
  activityIds: readonly string[],
  beforeMin: number,
  afterMin: number,
): WindowedActivities {
  const seed = storage.activities.getByIds(activityIds)
  if (seed.length === 0) {
    throw new Error('Sighting has no resolvable activities')
  }

  const minStart = Math.min(...seed.map((a) => a.startTimestamp))
  const maxEnd = Math.max(...seed.map((a) => a.endTimestamp))
  const dayStart = localMidnight(minStart)
  const dayEnd = dayStart + DAY_MS

  const windowFrom = Math.max(dayStart, minStart - beforeMin * 60_000)
  const windowTo = Math.min(dayEnd, maxEnd + afterMin * 60_000)

  // getForDay returns lightweight rows (no OCR); filter to the window, then
  // rehydrate full rows by id so ocrText is present (needed for the grounding
  // embedding in seedFixtureDb).
  const details = storage.activities.getForDay(dayStart, dayEnd)
  const inWindow = details.filter(
    (d) => d.endTimestamp >= windowFrom && d.startTimestamp < windowTo,
  )
  const stored = storage.activities.getByIds(inWindow.map((d) => d.id))

  const activities = stored
    .map((s) => toFixtureActivity(s, dayStart))
    .sort((x, y) => x.offsetMin - y.offsetMin)

  return { activities, dayStart, windowFrom, windowTo }
}

function offsetToHhmm(offsetMin: number): string {
  const m = ((offsetMin % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** One hand-editable `keep` block seeded from a sighting. */
export interface GoldenBlockSeed {
  title: string
  apps: string[]
  activityIds: string[]
  description: string
}

/**
 * Renders golden.md for a single sighting: a feedback instruction, one editable
 * `keep` block, then a chronological reference of every activity id in the
 * window. Round-trips through `parseTaskGoldenMd` (the `Notes:` line folds into
 * the description — fine for a human-feedback golden).
 */
export function renderSightingGoldenMd(
  name: string,
  block: GoldenBlockSeed,
  activities: TaskFixtureActivity[],
): string {
  const sorted = [...activities].sort((a, b) => a.offsetMin - b.offsetMin)

  const lines: string[] = []
  lines.push(`# Golden tasks — ${name}`)
  lines.push('')
  lines.push('<!-- Feedback golden built from a sighting. Edit the block below:')
  lines.push('     fix the title / Apps / Activities, rewrite the description, set')
  lines.push('     Verdict (keep = a legit task, reject = the miner shouldn’t surface')
  lines.push('     this), and add free-text notes after "Notes:" on what the miner')
  lines.push('     missed or got wrong. The day reference at the bottom lists every')
  lines.push('     activity id in the window. -->')
  lines.push('')

  lines.push(`## ${block.title}`)
  lines.push('Verdict: keep')
  lines.push(`Apps: ${block.apps.join(', ')}`)
  lines.push(`Activities: ${block.activityIds.join(', ')}`)
  lines.push('')
  if (block.description.trim()) lines.push(block.description.trim())
  lines.push('')
  lines.push('Notes:')
  lines.push('')
  lines.push('---')
  lines.push('')

  lines.push('<!-- THE DAY — chronological reference of every activity id in the window.')
  for (const a of sorted) {
    const title = a.windowTitle ? ` — ${a.windowTitle}` : ''
    const sum = a.summary.replace(/\s+/g, ' ').slice(0, 100)
    lines.push(`  ${a.id}  ${offsetToHhmm(a.offsetMin)} [${a.app}${title}]  ${sum}`)
  }
  lines.push('-->')
  lines.push('')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Promoting a semantic-summary golden into a task + placing it in a noise day
// ---------------------------------------------------------------------------

export type PlacementMode = 'contiguous' | 'multitask'

export interface SemanticTaskResult {
  /** Task activities with offsets RELATIVE to the task start (laid out
   *  back-to-back). Absolute offsets are assigned later by `placeTask`. */
  activities: TaskFixtureActivity[]
  /** A `keep` block seeded from the whole task (every minted id). */
  block: GoldenBlockSeed
}

/**
 * Promotes a parsed semantic-summary golden (one block per activity) into the
 * pieces of a task-mining `keep` task: drops the DROPPED blocks, mints stable
 * ids (`<idPrefix>-NN`), and lays the kept activities out back-to-back (each
 * starts where the previous ended) so the task reads as one coherent episode.
 * Semantic goldens carry no OCR, so `ocrText` is left empty — the summaries
 * drive both the scan and the grounding tools.
 */
export function semanticGoldenToTask(params: {
  goldens: GoldenActivity[]
  idPrefix: string
  title: string
  description: string
  /**
   * 1-based indices (over the *kept*, non-dropped blocks) to leave OUT of the
   * `keep` block — they stay as day activities but aren't part of the golden
   * task, so the miner is penalised for absorbing them (grounding precision).
   * E.g. `[1]` drops a recorder-start / unrelated opener that bookends the task.
   */
  keepExclude?: number[]
}): SemanticTaskResult {
  const kept = params.goldens.filter((g) => !g.dropped)
  if (kept.length === 0) {
    throw new Error('Semantic golden has no non-dropped blocks to promote')
  }

  let cursor = 0
  const activities: TaskFixtureActivity[] = kept.map((g, i) => {
    const durationMin = Math.max(1, Math.round((g.endOffsetMs - g.startOffsetMs) / 60_000))
    const activity: TaskFixtureActivity = {
      id: `${params.idPrefix}-${String(i + 1).padStart(2, '0')}`,
      offsetMin: cursor,
      durationMin,
      app: g.appName,
      windowTitle: g.windowTitle ?? '',
      tld: g.tld ?? null,
      summary: g.summary,
      ocrText: '',
    }
    cursor += durationMin
    return activity
  })

  const exclude = new Set(params.keepExclude ?? [])
  const inBlock = activities.filter((_, i) => !exclude.has(i + 1))
  const blockActivities = inBlock.length > 0 ? inBlock : activities

  return {
    activities,
    block: {
      title: params.title,
      apps: [...new Set(blockActivities.map((a) => a.app))],
      activityIds: blockActivities.map((a) => a.id),
      description: params.description,
    },
  }
}

/** Total minutes the task occupies (its last activity's end), 0 when empty. */
function taskSpanMin(task: readonly TaskFixtureActivity[]): number {
  return task.reduce((max, a) => Math.max(max, a.offsetMin + a.durationMin), 0)
}

/**
 * Start offset (min from midnight) of the largest inter-activity gap in the
 * noise day that fits `spanMin`. `fallbackMin` when nothing fits (or no noise).
 */
export function largestGapOffset(
  noise: readonly TaskFixtureActivity[],
  spanMin: number,
  fallbackMin: number,
): number {
  if (noise.length === 0) return fallbackMin
  const sorted = [...noise].sort((a, b) => a.offsetMin - b.offsetMin)
  let bestStart = fallbackMin
  let bestGap = -1
  for (let i = 0; i < sorted.length - 1; i++) {
    const end = sorted[i].offsetMin + sorted[i].durationMin
    const gap = sorted[i + 1].offsetMin - end
    if (gap >= spanMin && gap > bestGap) {
      bestGap = gap
      bestStart = end + 1
    }
  }
  return bestStart
}

/** Index into `sortedStarts` of the tightest run of `need` consecutive
 *  activities (smallest wall-clock span) — the busiest stretch to weave the
 *  task through, so its interruptions are genuinely back-to-back rather than
 *  separated by idle gaps. */
function densestRunStart(sortedStarts: number[], need: number): number {
  let bestStart = 0
  let bestSpan = Infinity
  for (let s = 0; s + need <= sortedStarts.length; s++) {
    const span = sortedStarts[s + need - 1] - sortedStarts[s]
    if (span < bestSpan) {
      bestSpan = span
      bestStart = s
    }
  }
  return bestStart
}

export interface PlaceOptions {
  /** Multitask only: unrelated activities to interleave between consecutive
   *  task steps (default 3). The task is woven into the day's tightest run of
   *  activity so each step is separated by ~this many interruptions —
   *  density-independent, unlike a wall-clock spread. */
  interruptions?: number
  /** Offset used when there is no noise to anchor to (default 583 ≈ 09:43). */
  fallbackOffsetMin?: number
}

/**
 * Assigns absolute `offsetMin` to a task's activities relative to a noise day,
 * returning clones (the input task keeps its relative offsets).
 *
 * - `contiguous`: pack the task into the largest free gap, preserving its
 *   back-to-back internal layout — the miner sees one uninterrupted episode.
 * - `multitask`: weave the task's steps through the day's tightest run of
 *   activity so `interruptions` unrelated activities sit *between* consecutive
 *   steps — the miner must stitch the task across them and exclude them.
 */
export function placeTask(
  task: readonly TaskFixtureActivity[],
  noise: readonly TaskFixtureActivity[],
  mode: PlacementMode,
  opts: PlaceOptions = {},
): TaskFixtureActivity[] {
  const sorted = [...task].sort((a, b) => a.offsetMin - b.offsetMin)
  const fallback = opts.fallbackOffsetMin ?? 583
  const maxOffset = 24 * 60 - 1

  if (mode === 'contiguous') {
    const base = largestGapOffset(noise, taskSpanMin(sorted), fallback)
    return sorted.map((a) => ({ ...a, offsetMin: Math.min(base + a.offsetMin, maxOffset) }))
  }

  // multitask: anchor each step to a noise activity, leaving `gap` unrelated
  // activities between consecutive steps (density-independent interleaving).
  const n = sorted.length
  const gap = Math.max(0, opts.interruptions ?? 3)
  const starts = noise.map((a) => a.offsetMin).sort((x, y) => x - y)
  if (starts.length === 0) {
    return sorted.map((a) => ({ ...a, offsetMin: Math.min(fallback + a.offsetMin, maxOffset) }))
  }
  const need = (n - 1) * (gap + 1) + 1
  const runStart = densestRunStart(starts, Math.min(need, starts.length))
  let prev = -1
  return sorted.map((a, i) => {
    const anchorIdx = Math.min(runStart + i * (gap + 1), starts.length - 1)
    let off = starts[anchorIdx]
    if (off <= prev) off = prev + 1
    prev = off
    return { ...a, offsetMin: Math.min(off, maxOffset) }
  })
}
