/**
 * TLD extraction utilities for browser activity boundary detection.
 * Used to detect when a user navigates to a different domain within the same browser,
 * which should be treated as an activity boundary.
 */

/**
 * Extract the effective domain from a URL string.
 * Returns the hostname (e.g., "github.com" from "https://github.com/user/repo").
 * Returns null if the URL is invalid or empty.
 */
export function extractTld(url: string | undefined | null): string | null {
  if (!url) return null

  try {
    const parsed = new URL(url)
    return parsed.host || null
  } catch {
    return null
  }
}
