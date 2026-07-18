/**
 * Read-side helpers for the cluster (Patterns) view: turning member sightings
 * into the derived fields the UI needs — a recurrence histogram, duration
 * stats, and a display title fallback when a cluster hasn't been LLM-labeled
 * yet.
 */

import { CLUSTER_VIEW_CONFIG } from '@/shared/constants'
import type {
  ClusterInfo,
  ClustersView,
  ClusterKind,
  RecurrenceBucket,
  RecurrenceUnit,
} from '@types'

const DAY_MS = 24 * 60 * 60 * 1000
// 1970-01-05 (day index 4) was a Monday; anchor week buckets to it.
const EPOCH_MONDAY_DAY = 4

/** Start of the window all cluster stats (and run listings) are computed over. */
export function statsWindowStart(now: number): number {
  return now - CLUSTER_VIEW_CONFIG.STATS_WINDOW_DAYS * DAY_MS
}

/**
 * Days since epoch of the timestamp's LOCAL calendar day — buckets must match
 * the local days the rest of the stats (observedDays, day headings) use.
 */
function localDayIndex(ts: number): number {
  return Math.floor((ts - new Date(ts).getTimezoneOffset() * 60_000) / DAY_MS)
}

function bucketIndex(ts: number, unit: RecurrenceUnit): number {
  const day = localDayIndex(ts)
  return unit === 'day' ? day : Math.floor((day - EPOCH_MONDAY_DAY) / 7)
}

/** Local midnight of the bucket's first calendar day (renders correctly via toLocaleDateString). */
function bucketStart(index: number, unit: RecurrenceUnit): number {
  const day = unit === 'day' ? index : index * 7 + EPOCH_MONDAY_DAY
  const utc = new Date(day * DAY_MS)
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate()).getTime()
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
  // Span in calendar days (bucket indices), not fractional days — a fractional
  // span under maxBuckets can still straddle maxBuckets+1 calendar days.
  const spanDays = bucketIndex(nowMs, 'day') - bucketIndex(first, 'day')
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
    steps?: string[]
    variables?: string[]
  },
  allMembers: ClusterMember[],
  observedDays: number,
  now: number,
): ClusterInfo {
  // Window the numerator to the same period as observedDays — pruning only
  // runs during mining runs, so stored members can outlive the stats window.
  const windowStart = statsWindowStart(now)
  const members = allMembers.filter((m) => m.startedAt >= windowStart)
  const startedAts = members.map((m) => m.startedAt)
  const activeMins = members.map((m) => Math.max(0, m.interactionMin))
  const apps = new Set<string>()
  for (const m of members) for (const app of m.apps) apps.add(app)
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
    totalActiveMin: activeMins.reduce((sum, v) => sum + v, 0),
    kind: cluster.kind,
    mechanism: cluster.mechanism,
    steps: cluster.steps ?? [],
    variables: cluster.variables ?? [],
    firstSeenAt: members.length > 0 ? Math.min(...startedAts) : null,
    lastSeenAt: members.length > 0 ? Math.max(...members.map((m) => m.endedAt)) : null,
    recurrence: recurrence.buckets,
    recurrenceUnit: recurrence.unit,
  }
}

/** The storage surface the clusters view reads from (satisfied by StorageService). */
export interface ClusterViewStore {
  clusters: {
    getAll(): {
      id: string
      label: string
      description: string
      kind: ClusterKind
      mechanism: string
    }[]
    getMemberDigest(): ({ clusterId: string } & ClusterMember)[]
  }
  activities: {
    countDistinctActiveDays(windowStart: number, windowEnd: number): number
  }
}

/** Frequency denominator: distinct captured days in the same window sightings are retained for. */
export function countObservedDays(store: ClusterViewStore, now: number): number {
  return store.activities.countDistinctActiveDays(statsWindowStart(now), now)
}

/** Case-insensitive keyword filter over the fields shown in the clusters view. */
export function filterClusters(clusters: ClusterInfo[], query: string): ClusterInfo[] {
  const q = query.toLowerCase()
  return clusters.filter((c) =>
    [c.title, c.description, c.mechanism, c.apps.join(' ')].some((field) =>
      field.toLowerCase().includes(q),
    ),
  )
}

export const MISSING_TABLES_TEXT =
  'Task-mining tables not found in this database. Launch the MemoryLane app once ' +
  '(it creates them on startup) and let task mining run, then retry.'

/** The cluster tables are created by the app, not by consumers that open the DB read-only. */
export function isMissingClusterTables(error: unknown): boolean {
  return (
    error instanceof Error &&
    /no such table: (clusters|cluster_sightings|sightings|mining_days)/.test(error.message)
  )
}

/**
 * The clusters view served to both the Patterns UI and the MCP pattern tools:
 * visible clusters (most frequent first) plus the noise-floor hidden count.
 * One digest query for all members → stats, recurrence, title fallback (no N+1).
 */
export function computeClustersView(
  store: ClusterViewStore,
  now: number,
): ClustersView & { observedDays: number } {
  const membersByCluster = new Map<string, ClusterMember[]>()
  for (const { clusterId, ...member } of store.clusters.getMemberDigest()) {
    let list = membersByCluster.get(clusterId)
    if (!list) {
      list = []
      membersByCluster.set(clusterId, list)
    }
    list.push(member)
  }
  const observedDays = countObservedDays(store, now)
  const infos = store.clusters
    .getAll()
    .map((c) => buildClusterInfo(c, membersByCluster.get(c.id) ?? [], observedDays, now))
    // Clusters with no in-window members are dead rows awaiting cleanup, not
    // "hidden noise" — exclude them from the view and the hidden count.
    .filter((c) => c.timesSeen > 0)
  const visible = infos
    .filter((c) => !isBelowNoiseFloor(c.timesSeen, c.totalActiveMin))
    .sort((a, b) => b.timesSeen - a.timesSeen || (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))
  return { clusters: visible, hiddenCount: infos.length - visible.length, observedDays }
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
