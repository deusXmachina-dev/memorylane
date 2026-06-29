import { APICallError } from 'ai'

/**
 * Best-effort HTTP status extraction from an inference error.
 *
 * - AI SDK calls throw `APICallError` carrying `statusCode`.
 * - The raw video path throws `Error("<status> <statusText> ...")` (invoke.ts),
 *   so the status is the leading 3-digit token of the message.
 * - Network/timeout/abort errors have no status → null.
 */
export function extractHttpStatus(error: unknown): number | null {
  if (APICallError.isInstance(error) && typeof error.statusCode === 'number') {
    return error.statusCode
  }
  const message = error instanceof Error ? error.message : String(error)
  const match = /^\s*(\d{3})\b/.exec(message)
  if (match) {
    return Number(match[1])
  }
  return null
}

/**
 * Whether a failed request should mark the LLM as unhealthy.
 *
 * Counts non-HTTP failures (timeout/network, status === null) and genuine
 * error responses (>= 400), but excludes transient codes that a healthy
 * provider returns under load: 429 (rate limited) and 529 (overloaded).
 */
export function isHealthAffectingStatus(status: number | null): boolean {
  if (status === null) return true
  return status >= 400 && status !== 429 && status !== 529
}
