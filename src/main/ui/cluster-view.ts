/**
 * Read-side helpers for the cluster (Patterns) view: turning member sightings
 * into the derived fields the UI needs — a recurrence histogram and a display
 * title fallback when a cluster hasn't been LLM-labeled yet.
 */

import type { RecurrenceBucket, RecurrenceUnit } from '../../shared/types'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
// 1970-01-05 was a Monday; anchor week buckets (UTC) to it.
const EPOCH_MONDAY_MS = 4 * DAY_MS

function bucketIndex(ts: number, unit: RecurrenceUnit): number {
  return unit === 'day' ? Math.floor(ts / DAY_MS) : Math.floor((ts - EPOCH_MONDAY_MS) / WEEK_MS)
}

function bucketStart(index: number, unit: RecurrenceUnit): number {
  return unit === 'day' ? index * DAY_MS : index * WEEK_MS + EPOCH_MONDAY_MS
}

export interface Recurrence {
  unit: RecurrenceUnit
  buckets: RecurrenceBucket[]
}

/**
 * Recurrence histogram from sighting start times. Uses day buckets when the
 * cluster's active span fits within `maxBuckets` days, else week buckets — so
 * recent clusters show individual days (you can see which day a sighting
 * happened) without long-lived clusters exploding into hundreds of empty bars.
 * Dense (zero-filled), newest bucket last, capped to the most recent `maxBuckets`.
 */
export function computeRecurrence(
  startedAts: number[],
  nowMs: number,
  maxBuckets = 24,
): Recurrence {
  if (startedAts.length === 0) return { unit: 'day', buckets: [] }
  const first = Math.min(...startedAts)
  const spanDays = Math.max(0, (nowMs - first) / DAY_MS)
  const unit: RecurrenceUnit = spanDays < maxBuckets ? 'day' : 'week'
  const nowIdx = bucketIndex(nowMs, unit)
  const counts = new Map<number, number>()
  let firstIdx = nowIdx
  for (const ts of startedAts) {
    const b = bucketIndex(ts, unit)
    if (b < firstIdx) firstIdx = b
    counts.set(b, (counts.get(b) ?? 0) + 1)
  }
  const startIdx = Math.max(firstIdx, nowIdx - maxBuckets + 1)
  const buckets: RecurrenceBucket[] = []
  for (let i = startIdx; i <= nowIdx; i++) {
    buckets.push({ start: bucketStart(i, unit), count: counts.get(i) ?? 0 })
  }
  return { unit, buckets }
}

/**
 * A cluster's display title: its LLM label if set, otherwise the most common
 * member sighting title (ties broken by earliest occurrence).
 */
export function resolveTitle(label: string, memberTitles: string[]): string {
  const trimmed = label.trim()
  if (trimmed) return trimmed
  const freq = new Map<string, number>()
  for (const t of memberTitles) {
    const key = t.trim()
    if (!key) continue
    freq.set(key, (freq.get(key) ?? 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [title, count] of freq) {
    if (count > bestCount) {
      best = title
      bestCount = count
    }
  }
  return best || 'Untitled task'
}
