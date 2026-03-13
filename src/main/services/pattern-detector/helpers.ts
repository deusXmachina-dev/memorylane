import { v5 as uuidv5 } from 'uuid'
import type { ActivityDetail } from '../../storage'
import type { VerifiedFinding } from './types'

const PATTERN_NAMESPACE = uuidv5('memorylane:pattern', uuidv5.DNS)

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

export function generatePatternId(name: string): string {
  return uuidv5(name.toLowerCase().trim(), PATTERN_NAMESPACE)
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

// Keep for backwards compatibility with tests
export function extractFindingsFromResponse(content: string): VerifiedFinding[] {
  return extractJsonArray<VerifiedFinding>(content)
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
