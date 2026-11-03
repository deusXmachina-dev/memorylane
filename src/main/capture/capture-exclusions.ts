import { isSelfAppToken, normalizeAppToken } from '@/shared/app-utils'
import { domainOf } from '@/shared/url-utils'

export interface ExclusionWindowContext {
  processName?: string
  bundleId?: string
  title?: string
  url?: string
}

// An app's match token is its full bundle id (macOS), normalized. The whole id —
// not just the last segment — keeps it unique, so `com.microsoft.excel` blocks
// only Excel, never a sibling like `com.microsoft.word`.
export function tokenFromBundleId(bundleId: string): string {
  return normalizeAppToken(bundleId)
}

export function appToken(window: { app?: string; bundleId?: string }): string | null {
  if (window.bundleId) {
    const token = tokenFromBundleId(window.bundleId)
    if (token) return token
  }
  if (window.app) {
    const token = normalizeAppToken(window.app)
    if (token) return token
  }
  return null
}

export function isSelfApp(window: { app?: string; bundleId?: string }): boolean {
  const token = appToken(window)
  return token !== null && isSelfAppToken(token)
}

function normalizePatternToken(value: string): string {
  return value.trim().toLowerCase()
}

export function normalizeExcludedApps(values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values)) return []

  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    if (typeof value !== 'string') continue
    const token = normalizeAppToken(value)
    if (token.length === 0 || seen.has(token) || isSelfAppToken(token)) continue
    seen.add(token)
    normalized.push(token)
  }

  return normalized
}

export function normalizeWildcardPatterns(values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values)) return []

  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    if (typeof value !== 'string') continue
    const pattern = normalizePatternToken(value)
    if (pattern.length === 0 || seen.has(pattern)) continue
    seen.add(pattern)
    normalized.push(pattern)
  }

  return normalized
}

const wildcardRegexCache = new Map<string, RegExp>()

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A wildcard entry (contains `*`) matches as a substring anywhere in the URL,
// with `*` standing for any run of characters. Every other character — including
// `?`, which is common in query strings — is literal. The match is unanchored.
function wildcardToRegex(pattern: string): RegExp {
  const cached = wildcardRegexCache.get(pattern)
  if (cached) return cached

  const body = escapeRegex(pattern).replace(/\\\*/g, '.*')
  const regex = new RegExp(body)
  wildcardRegexCache.set(pattern, regex)
  return regex
}

// An app is identified by one thing per platform: its bundle id on macOS, its
// executable name on Windows. We match on that alone — no last-segment or
// localized-name fallbacks — so each id is unique and can't sweep up siblings.
// `processName` is the macOS localized name (ignored when a bundle id is present)
// and the Windows exe name; it's the fallback only for the rare process that
// reports no bundle id.
function collectCandidates(window: ExclusionWindowContext | undefined): string[] {
  if (!window) return []

  const identity = window.bundleId
    ? normalizeAppToken(window.bundleId)
    : window.processName
      ? normalizeAppToken(window.processName)
      : ''

  return identity.length > 0 ? [identity] : []
}

export function getExcludedAppMatch(
  window: ExclusionWindowContext | undefined,
  excludedApps: ReadonlySet<string>,
): string | null {
  if (excludedApps.size === 0) return null

  for (const candidate of collectCandidates(window)) {
    if (excludedApps.has(candidate)) {
      return candidate
    }
  }

  return null
}

// An exclusion entry is one of two kinds (see `normalizeUrlPattern`):
//  - a wildcard (`*`): substring match anywhere in the URL.
//  - a domain (no `*`): matched against the URL host, subdomain-inclusive
//    (`host === entry` or `host` ends with `.entry`), so `linkedin.com` blocks
//    `www.linkedin.com` and `m.linkedin.com` but not `evil-linkedin.com`.
// Entries are assumed already normalized (domain reduced to a bare host, leading
// `www.` dropped); the URL host is reduced the same way via `domainOf`.
export function getExcludedUrlMatch(
  window: ExclusionWindowContext | undefined,
  patterns: readonly string[],
): string | null {
  const url = window?.url
  if (!url || patterns.length === 0) return null
  const lowerUrl = url.toLowerCase()
  const host = domainOf(lowerUrl)

  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      if (wildcardToRegex(pattern).test(lowerUrl)) return pattern
    } else if (host !== null && (host === pattern || host.endsWith(`.${pattern}`))) {
      return pattern
    }
  }

  return null
}
