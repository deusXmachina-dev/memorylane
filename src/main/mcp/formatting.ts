import { ActivitySummary } from '../storage'

/**
 * Formats a single activity as a compact summary line with duration and screenshot count.
 */
export function formatActivityLine(activity: {
  id: string
  startTimestamp: number
  endTimestamp: number
  appName?: string | null
  summary?: string | null
}): string {
  const timeStr = new Date(activity.startTimestamp).toLocaleString()
  const appInfo = activity.appName ? ` [${activity.appName}]` : ''
  const summary = activity.summary || '(no summary)'
  return `- ${activity.id} | ${timeStr}${appInfo} | ${summary}`
}

/**
 * Unified result type for timeline entries.
 */
export interface TimelineEntry {
  id: string
  timestamp: number
  appName: string
  windowTitle: string
  summary: string
}

/**
 * Convert ActivitySummary to TimelineEntry.
 */
export function activityToTimelineEntry(activity: ActivitySummary): TimelineEntry {
  return {
    id: activity.id,
    timestamp: activity.startTimestamp,
    appName: activity.appName ?? '',
    windowTitle: activity.windowTitle ?? '',
    summary: activity.summary ?? '',
  }
}

/**
 * Format a TimelineEntry as a compact summary line.
 */
export function formatTimelineEntry(entry: TimelineEntry): string {
  const timeStr = new Date(entry.timestamp).toLocaleString()
  const appInfo = entry.appName ? ` [${entry.appName}]` : ''
  const windowInfo = entry.windowTitle ? ` [window: ${JSON.stringify(entry.windowTitle)}]` : ''
  const summary = entry.summary || '(no summary)'
  return `- ${entry.id} | ${timeStr}${appInfo}${windowInfo} | ${summary}`
}

/**
 * Samples entries down to the limit using the chosen strategy.
 */
export function sampleEntries<T>(
  entries: T[],
  limit: number,
  sampling: 'uniform' | 'recent_first',
): T[] {
  if (limit <= 0) return []
  if (limit === 1) return entries.length > 0 ? [entries[0] as T] : []
  if (entries.length <= limit) return entries

  if (sampling === 'recent_first') {
    return entries.slice(-limit)
  }

  // Uniform: pick evenly spaced indices across the full range
  const result: T[] = []
  const step = (entries.length - 1) / (limit - 1)
  for (let i = 0; i < limit; i++) {
    const idx = Math.round(i * step)
    if (idx < entries.length) {
      result.push(entries[idx] as T)
    }
  }
  return result
}
