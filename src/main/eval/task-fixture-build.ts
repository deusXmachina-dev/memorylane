/**
 * Shared helpers for turning real activities into a task-mining fixture.
 *
 * Used by both the `export-day` CLI (a whole day) and the in-app Tasks tab
 * (a single sighting + a noise window around it). The on-disk shape is the same
 * either way: `TaskFixtureActivity[]` (→ activities.jsonl) plus a `golden.md`.
 */

import type { StorageService } from '../storage'
import type { StoredActivity } from '../storage/types'
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
