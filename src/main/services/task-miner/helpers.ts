import { SIGHTING_BRIDGE_MAX_GAP_MS } from '../../../shared/constants'
import type { ActivityDetail } from '../../storage'

interface TimeBounded {
  startTimestamp: number
  endTimestamp: number
}

/**
 * Compute a sighting's time window and active time directly from its
 * constituent activities — never from an LLM estimate.
 *
 * - `startedAt` / `endedAt`: min start / max end across the activities.
 * - `interactionMin`: union of the activities' [start, end] intervals, bridging
 *   gaps up to `SIGHTING_BRIDGE_MAX_GAP_MS` so pauses inside one run count while
 *   longer breaks do not. Overlapping or nested activities are not
 *   double-counted, so active time never exceeds the wall-clock span, which is
 *   just `endedAt - startedAt`, derived on read.
 */
export function computeEpisodeWindow(activities: TimeBounded[]): {
  startedAt: number
  endedAt: number
  interactionMin: number
} {
  if (activities.length === 0) {
    return { startedAt: 0, endedAt: 0, interactionMin: 0 }
  }
  const intervals = activities
    .map((a) => ({ start: a.startTimestamp, end: Math.max(a.startTimestamp, a.endTimestamp) }))
    .sort((a, b) => a.start - b.start)
  const startedAt = intervals[0].start
  let endedAt = intervals[0].end
  let unionMs = 0
  let curEnd = intervals[0].end
  let curStart = intervals[0].start
  for (let i = 1; i < intervals.length; i++) {
    const { start, end } = intervals[i]
    if (start <= curEnd + SIGHTING_BRIDGE_MAX_GAP_MS) {
      curEnd = Math.max(curEnd, end)
    } else {
      unionMs += curEnd - curStart
      curStart = start
      curEnd = end
    }
    if (end > endedAt) endedAt = end
  }
  unionMs += curEnd - curStart
  return {
    startedAt,
    endedAt,
    interactionMin: Math.round((unionMs / 60000) * 10) / 10,
  }
}

export function serializeActivities(activities: ActivityDetail[]): object[] {
  return activities.map((a) => ({
    id: a.id,
    time: new Date(a.startTimestamp).toISOString(),
    duration_min: Math.round((a.endTimestamp - a.startTimestamp) / 60000),
    app: a.appName,
    window_title: a.windowTitle,
    summary: a.summary,
  }))
}

/**
 * Distinguishes failure from an empty answer: null when no JSON array could be
 * parsed, the (possibly empty) array when the response contained one.
 */
export function tryExtractJsonArray<T>(content: string): T[] | null {
  const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  const jsonStr = jsonMatch ? jsonMatch[1] : content

  try {
    const parsed = JSON.parse(jsonStr)
    return Array.isArray(parsed) ? (parsed as T[]) : null
  } catch {
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/)
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0])
        return Array.isArray(parsed) ? (parsed as T[]) : null
      } catch {
        return null
      }
    }
    return null
  }
}

export function extractJsonObject<T>(content: string): T | null {
  const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  const jsonStr = jsonMatch ? jsonMatch[1] : content

  try {
    const parsed = JSON.parse(jsonStr)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as T
    return null
  } catch {
    const objMatch = jsonStr.match(/\{[\s\S]*\}/)
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]) as T
      } catch {
        return null
      }
    }
    return null
  }
}

/**
 * Extract a human-readable message from OpenRouter SDK errors.
 * ChatError has an `.error` object with `{ code, message, type }`.
 */
export function formatApiError(error: unknown): string {
  if (error && typeof error === 'object' && 'error' in error) {
    const inner = (error as { error: { code?: unknown; message?: string; type?: string } }).error
    if (inner?.message) {
      const parts = [inner.message]
      if (inner.code) parts.push(`code=${inner.code}`)
      if (inner.type) parts.push(`type=${inner.type}`)
      return parts.join(' ')
    }
  }
  if (error instanceof Error) return error.message
  return String(error)
}
