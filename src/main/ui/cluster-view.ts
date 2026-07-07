/**
 * Read-side helpers for the cluster (Patterns) view: turning member sightings
 * into the derived fields the UI needs — a recurrence histogram, duration
 * stats, and a display title fallback when a cluster hasn't been LLM-labeled
 * yet.
 */

import { CLUSTER_VIEW_CONFIG } from '../../shared/constants'
import type { ClusterInfo, ClusterKind, RecurrenceBucket, RecurrenceUnit } from '../../shared/types'

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

export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** Runs per week: timesSeen over the observed-day count, scaled to 7 days. */
export function timesPerWeek(timesSeen: number, observedDays: number): number {
  if (observedDays <= 0) return 0
  return (timesSeen / observedDays) * 7
}

/**
 * Noise floor for the Patterns list: a cluster seen once is hidden unless its
 * total active time already clears the floor. Genuine micro-toil graduates on
 * its second sighting; one-off work never does.
 */
export function isBelowNoiseFloor(timesSeen: number, totalActiveMin: number): boolean {
  return (
    timesSeen < CLUSTER_VIEW_CONFIG.MIN_TIMES_SEEN &&
    totalActiveMin < CLUSTER_VIEW_CONFIG.SINGLETON_MIN_TOTAL_ACTIVE_MIN
  )
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

/** The per-member fields cluster stats are derived from (a subset of Sighting). */
export interface ClusterMember {
  startedAt: number
  endedAt: number
  interactionMin: number
  title: string
  apps: string[]
}

/**
 * Assemble the UI-facing ClusterInfo from a cluster row and its member
 * sightings — the single derivation used by both the list and detail IPC
 * handlers.
 */
export function buildClusterInfo(
  cluster: {
    id: string
    label: string
    description: string
    kind: ClusterKind
    mechanism: string
  },
  members: ClusterMember[],
  observedDays: number,
  now: number,
): ClusterInfo {
  const startedAts = members.map((m) => m.startedAt)
  const spansMin = members.map((m) => Math.max(0, m.endedAt - m.startedAt) / 60_000)
  const activeMins = members.map((m) => Math.max(0, m.interactionMin))
  const apps = new Set<string>()
  for (const m of members) for (const app of m.apps) apps.add(app)
  const avgSpanMin = mean(spansMin)
  const avgActiveMin = mean(activeMins)
  const recurrence = computeRecurrence(startedAts, now)
  return {
    id: cluster.id,
    title: resolveTitle(
      cluster.label,
      members.map((m) => m.title),
    ),
    description: cluster.description,
    apps: [...apps],
    timesSeen: members.length,
    timesPerWeek: timesPerWeek(members.length, observedDays),
    observedDays,
    avgActiveMin,
    avgSpanMin,
    avgIdleMin: Math.max(0, avgSpanMin - avgActiveMin),
    totalActiveMin: activeMins.reduce((sum, v) => sum + v, 0),
    kind: cluster.kind,
    mechanism: cluster.mechanism,
    firstSeenAt: members.length > 0 ? Math.min(...startedAts) : null,
    lastSeenAt: members.length > 0 ? Math.max(...members.map((m) => m.endedAt)) : null,
    recurrence: recurrence.buckets,
    recurrenceUnit: recurrence.unit,
  }
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
