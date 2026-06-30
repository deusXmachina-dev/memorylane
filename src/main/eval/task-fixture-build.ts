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
 * Renders golden.md for one or more `keep` blocks: a feedback instruction, each
 * editable `keep` block in turn (separated by `---`), then a chronological
 * reference of every activity id in the window. Each block ends in a `---`, so
 * the trailing day-reference comment is ignored when `parseTaskGoldenMd` reads
 * the file back. A recurring task is N blocks — one per occurrence.
 */
export function renderTaskFixtureGoldenMd(
  name: string,
  blocks: readonly GoldenBlockSeed[],
  activities: TaskFixtureActivity[],
): string {
  const sorted = [...activities].sort((a, b) => a.offsetMin - b.offsetMin)

  const lines: string[] = []
  lines.push(`# Golden tasks — ${name}`)
  lines.push('')

  for (const block of blocks) {
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
  }

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

/** Single-block convenience wrapper (one sighting → one keep block). */
export function renderSightingGoldenMd(
  name: string,
  block: GoldenBlockSeed,
  activities: TaskFixtureActivity[],
): string {
  return renderTaskFixtureGoldenMd(name, [block], activities)
}

// ---------------------------------------------------------------------------
// Promoting a semantic-summary golden into a task + placing it in a noise day
// ---------------------------------------------------------------------------

export type PlacementMode = 'contiguous' | 'multitask'

/**
 * Names a fixture dir so it's self-describing and collision-free across the
 * variation axes: `<day>-<slug>[-multitask][-xN][-llm]`. `reorder`/`none` stay
 * unmarked so deterministic variants keep their existing names.
 */
export function fixtureName(
  day: string,
  slug: string,
  placement: PlacementMode,
  occurrences: number,
  vary: string, // 'none' | 'reorder' | 'llm'
): string {
  const multitask = placement === 'multitask' ? '-multitask' : ''
  const repeat = occurrences > 1 ? `-x${occurrences}` : ''
  const varyTag = vary === 'llm' ? '-llm' : ''
  return `${day}-${slug}${multitask}${repeat}${varyTag}`
}

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
 * The largest inter-activity gap in the noise day, and whether it can hold a
 * `spanMin` task without overlapping its neighbours. `start` is where such a task
 * would begin (the previous activity's end + 1); -1 when there's no gap to pick.
 *
 * `fits` requires `gap >= spanMin + 1`, not `>= spanMin`: the task starts one
 * minute after the previous activity ends, so it needs room for its own span PLUS
 * that one-minute lead, otherwise its last minute overlaps the next activity.
 */
function bestContiguousGap(
  noise: readonly TaskFixtureActivity[],
  spanMin: number,
): { start: number; fits: boolean } {
  if (noise.length < 2) return { start: -1, fits: false }
  const sorted = [...noise].sort((a, b) => a.offsetMin - b.offsetMin)
  let bestStart = -1
  let bestGap = -1
  for (let i = 0; i < sorted.length - 1; i++) {
    const end = sorted[i].offsetMin + sorted[i].durationMin
    const gap = sorted[i + 1].offsetMin - end
    if (gap > bestGap) {
      bestGap = gap
      bestStart = end + 1
    }
  }
  return { start: bestStart, fits: bestGap >= spanMin + 1 }
}

/**
 * Start offset (min from midnight) of the largest inter-activity gap that fits
 * `spanMin`. `fallbackMin` when nothing fits (or there's no noise).
 */
export function largestGapOffset(
  noise: readonly TaskFixtureActivity[],
  spanMin: number,
  fallbackMin: number,
): number {
  const gap = bestContiguousGap(noise, spanMin)
  return gap.fits ? gap.start : fallbackMin
}

/**
 * Last-resort base offset when no inter-activity gap fits the task: prefer the
 * empty span after the last (or before the first) noise activity — whichever is
 * larger and fits — so the task at least doesn't overlap real activity. Warns and
 * returns `fallbackMin` only when even the day's edges can't hold it.
 */
function edgeFallbackOffset(
  noise: readonly TaskFixtureActivity[],
  spanMin: number,
  fallbackMin: number,
  dayEndMin: number,
  onWarn?: (msg: string) => void,
): number {
  if (noise.length === 0) return fallbackMin
  const sorted = [...noise].sort((a, b) => a.offsetMin - b.offsetMin)
  const firstStart = sorted[0].offsetMin
  const lastEnd = sorted[sorted.length - 1].offsetMin + sorted[sorted.length - 1].durationMin
  const leadRoom = firstStart // [0, firstStart]
  const trailRoom = dayEndMin - lastEnd // [lastEnd, dayEnd]
  const leadFits = leadRoom >= spanMin + 1
  const trailFits = trailRoom >= spanMin + 1
  if (trailFits && trailRoom >= leadRoom) return lastEnd + 1
  if (leadFits) return Math.max(0, firstStart - spanMin - 1)
  if (trailFits) return lastEnd + 1
  onWarn?.(`task span ${spanMin}min doesn't fit any gap in the noise day — placing it over noise`)
  return fallbackMin
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
   *  density-independent, unlike a wall-clock spread. Reduced automatically (with
   *  a warning) when the noise can't supply that many. */
  interruptions?: number
  /** Offset used when there is no noise to anchor to (default 583 ≈ 09:43). */
  fallbackOffsetMin?: number
  /** Sink for non-fatal placement warnings (reduced interruptions, no-fit, …). */
  onWarn?: (msg: string) => void
}

/**
 * Assigns absolute `offsetMin` to a task's activities relative to a noise day,
 * returning clones (the input task keeps its relative offsets).
 *
 * - `contiguous`: pack the task into the largest free gap, preserving its
 *   back-to-back internal layout — the miner sees one uninterrupted episode. The
 *   base is clamped so the task never runs past end-of-day (so its tail can't
 *   stack onto the final minute).
 * - `multitask`: weave the task's steps through the day's tightest run of
 *   activity so `interruptions` unrelated activities sit *between* consecutive
 *   steps. When the noise can't supply that many, the count is reduced (and a
 *   warning emitted) rather than silently collapsing steps onto one another.
 */
export function placeTask(
  task: readonly TaskFixtureActivity[],
  noise: readonly TaskFixtureActivity[],
  mode: PlacementMode,
  opts: PlaceOptions = {},
): TaskFixtureActivity[] {
  const sorted = [...task].sort((a, b) => a.offsetMin - b.offsetMin)
  const fallback = opts.fallbackOffsetMin ?? 583
  const dayEndMin = 24 * 60
  const maxOffset = dayEndMin - 1
  const span = taskSpanMin(sorted)

  if (mode === 'contiguous') {
    const gap = bestContiguousGap(noise, span)
    const rawBase = gap.fits
      ? gap.start
      : edgeFallbackOffset(noise, span, fallback, dayEndMin, opts.onWarn)
    // Bound the base so the whole task fits in the day; otherwise the trailing
    // activities would clamp onto the final minute and stack.
    const base = Math.max(0, Math.min(rawBase, maxOffset - span))
    return sorted.map((a) => ({ ...a, offsetMin: base + a.offsetMin }))
  }

  // multitask: anchor each step to a noise activity, leaving `gapCount` unrelated
  // activities between consecutive steps (density-independent interleaving).
  const n = sorted.length
  const requested = Math.max(0, opts.interruptions ?? 3)
  const starts = noise.map((a) => a.offsetMin).sort((x, y) => x - y)
  if (starts.length === 0) {
    const base = Math.max(0, Math.min(fallback, maxOffset - span))
    return sorted.map((a) => ({ ...a, offsetMin: base + a.offsetMin }))
  }
  // Cap interruptions to what the noise can supply: the (n-1)*(gapCount+1)+1
  // anchors must all fit in `starts`, otherwise later steps would clamp onto the
  // same (last) noise activity and end up adjacent with nothing between them.
  const maxGap = n > 1 ? Math.max(0, Math.floor((starts.length - 1) / (n - 1)) - 1) : requested
  const gapCount = Math.min(requested, maxGap)
  if (n > 1 && requested >= 1 && gapCount < requested) {
    opts.onWarn?.(
      `reduced interruptions ${requested}→${gapCount}: only ${starts.length} noise ` +
        `activities to weave ${n} steps through` +
        (gapCount < 1 ? ' — steps may be adjacent' : ''),
    )
  }
  const need = (n - 1) * (gapCount + 1) + 1
  const runStart = densestRunStart(starts, Math.min(need, starts.length))
  let prev = -1
  return sorted.map((a, i) => {
    const anchorIdx = Math.min(runStart + i * (gapCount + 1), starts.length - 1)
    let off = starts[anchorIdx]
    if (off <= prev) off = prev + 1
    prev = off
    return { ...a, offsetMin: Math.min(off, maxOffset) }
  })
}

// ---------------------------------------------------------------------------
// Recurring tasks: N varied occurrences placed across one noise day
// ---------------------------------------------------------------------------

/** A small, deterministic adjacent-swap reorder seeded by the occurrence index —
 *  "the same task, done in a slightly different order". Returns a new array. */
function slightReorder(
  acts: readonly TaskFixtureActivity[],
  occurrenceIndex: number,
): TaskFixtureActivity[] {
  const out = [...acts]
  if (out.length < 2) return out
  const pos = (occurrenceIndex - 1) % (out.length - 1)
  ;[out[pos], out[pos + 1]] = [out[pos + 1], out[pos]]
  return out
}

export interface OccurrenceOptions {
  /** 1-based index of this occurrence within the recurring task. */
  index: number
  /** Total occurrences; when 1, ids and title keep their base form (no suffix). */
  total: number
  /** Slightly reorder the steps (only applied for occurrences after the first). */
  reorder?: boolean
}

/**
 * Clones a base task into one occurrence of a recurring task: mints fresh,
 * fixture-unique activity ids (`<baseId>-o<index>` when `total > 1`), optionally
 * reorders the steps a little, re-lays offsets back-to-back, and remaps the keep
 * block to the new ids with an occurrence-tagged title (`<title> (k/N)`). Summary
 * text is left intact — LLM paraphrasing, if any, is applied separately via
 * `applyParaphrasedSummaries`, so this stays pure and deterministic.
 */
export function cloneOccurrence(
  base: SemanticTaskResult,
  opts: OccurrenceOptions,
): SemanticTaskResult {
  const suffix = opts.total > 1 ? `-o${opts.index}` : ''
  const idMap = new Map<string, string>()
  let acts = base.activities.map((a) => {
    const id = `${a.id}${suffix}`
    idMap.set(a.id, id)
    return { ...a, id }
  })

  if (opts.reorder && opts.index > 1) acts = slightReorder(acts, opts.index)

  let cursor = 0
  acts = acts.map((a) => {
    const placed = { ...a, offsetMin: cursor }
    cursor += a.durationMin
    return placed
  })

  const inBlock = new Set(base.block.activityIds.map((id) => idMap.get(id) ?? id))
  const ordered = acts.filter((a) => inBlock.has(a.id))
  const title =
    opts.total > 1 ? `${base.block.title} (${opts.index}/${opts.total})` : base.block.title

  return {
    activities: acts,
    block: {
      title,
      apps: [...new Set(ordered.map((a) => a.app))],
      activityIds: ordered.map((a) => a.id),
      description: base.block.description,
    },
  }
}

/**
 * Returns a copy of an occurrence with each activity's summary replaced by the
 * paraphrase at the same position (when non-empty); ids, offsets, and the keep
 * block are untouched. `summaries` must align with `occ.activities` by index.
 */
export function applyParaphrasedSummaries(
  occ: SemanticTaskResult,
  summaries: readonly (string | null | undefined)[],
): SemanticTaskResult {
  const activities = occ.activities.map((a, i) => {
    const s = summaries[i]
    return s && s.trim() ? { ...a, summary: s.trim() } : a
  })
  return { activities, block: occ.block }
}

export interface PlaceOccurrencesResult {
  /** Absolute-offset activities, one array per occurrence (input order). */
  placed: TaskFixtureActivity[][]
  /** Non-fatal placement warnings to surface to the user. */
  warnings: string[]
}

/**
 * Places N occurrences of a recurring task into one noise day, each in its own
 * contiguous slice of the day's noise so occurrences are temporally separated —
 * the miner should surface each as a distinct sighting and then cluster them.
 * Each slice is placed with `placeTask`, so the per-occurrence `contiguous` /
 * `multitask` semantics and the bug-fixed gap/interleave logic apply within it.
 */
export function placeOccurrences(
  occurrences: readonly (readonly TaskFixtureActivity[])[],
  noise: readonly TaskFixtureActivity[],
  mode: PlacementMode,
  opts: PlaceOptions = {},
): PlaceOccurrencesResult {
  const warnings: string[] = []
  const sink = (msg: string): void => {
    warnings.push(msg)
    opts.onWarn?.(msg)
  }
  const N = occurrences.length
  if (N <= 1) {
    return {
      placed: occurrences.map((o) => placeTask(o, noise, mode, { ...opts, onWarn: sink })),
      warnings,
    }
  }

  const sortedNoise = [...noise].sort((a, b) => a.offsetMin - b.offsetMin)
  if (sortedNoise.length < N) {
    sink(
      `only ${sortedNoise.length} noise activities for ${N} occurrences — some won't be separated by noise`,
    )
  }

  const dayEndMin = 24 * 60
  const placed = occurrences.map((occ, i) => {
    const lo = Math.floor((i * sortedNoise.length) / N)
    const hi = Math.floor(((i + 1) * sortedNoise.length) / N)
    const chunk = sortedNoise.slice(lo, hi)
    const tag = (msg: string): void => sink(`occurrence ${i + 1}/${N}: ${msg}`)
    if (chunk.length === 0) {
      // No noise in this slice — spread the occurrence evenly across the day.
      const slot = Math.floor(((i + 0.5) * dayEndMin) / N)
      const base = Math.max(0, Math.min(slot, dayEndMin - 1 - taskSpanMin(occ)))
      tag('no noise in its time slice — placed without surrounding activity')
      return occ.map((a) => ({ ...a, offsetMin: base + a.offsetMin }))
    }
    return placeTask(occ, chunk, mode, { ...opts, onWarn: tag })
  })

  return { placed, warnings }
}
