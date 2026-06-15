import type { ActivityDetail } from '../../storage'

export function isSameDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

export function getDayBoundaries(daysBack: number): {
  start: number
  end: number
  label: string
} {
  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack)
  const start = day.getTime()
  const end = start + 24 * 60 * 60 * 1000 - 1
  const label = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
  return { start, end, label }
}

export function serializeActivities(activities: ActivityDetail[]): object[] {
  return activities.map((a) => ({
    id: a.id,
    time: new Date(a.startTimestamp).toISOString(),
    duration_min: Math.round((a.endTimestamp - a.startTimestamp) / 60000),
    app: a.appName,
    window_title: a.windowTitle,
    tld: a.tld,
    summary: a.summary,
  }))
}

interface TimeBounded {
  startTimestamp: number
  endTimestamp: number
}

/**
 * Compute a sighting's time window and on-task interaction time directly from
 * its constituent activities — never from an LLM estimate.
 *
 * - `startedAt` / `endedAt`: min start / max end across the activities.
 * - `interactionMin`: Σ of each activity's own duration (actual interaction
 *   time, excludes idle gaps between activities). Wall-clock span is just
 *   `endedAt - startedAt` and is derived on read, not stored.
 */
export function computeEpisodeWindow(activities: TimeBounded[]): {
  startedAt: number
  endedAt: number
  interactionMin: number
} {
  if (activities.length === 0) {
    return { startedAt: 0, endedAt: 0, interactionMin: 0 }
  }
  let startedAt = Infinity
  let endedAt = -Infinity
  let interactionMs = 0
  for (const a of activities) {
    if (a.startTimestamp < startedAt) startedAt = a.startTimestamp
    if (a.endTimestamp > endedAt) endedAt = a.endTimestamp
    interactionMs += Math.max(0, a.endTimestamp - a.startTimestamp)
  }
  return {
    startedAt,
    endedAt,
    interactionMin: Math.round((interactionMs / 60000) * 10) / 10,
  }
}

export function extractJsonArray<T>(content: string): T[] {
  const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  const jsonStr = jsonMatch ? jsonMatch[1] : content

  try {
    const parsed = JSON.parse(jsonStr)
    if (Array.isArray(parsed)) return parsed as T[]
    return []
  } catch {
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/)
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]) as T[]
      } catch {
        return []
      }
    }
    return []
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
