import { domainOf } from '../shared/url-utils'
import type { InstalledApp } from '../shared/types'

export interface ExclusionWindowContext {
  processName?: string
  bundleId?: string
  title?: string
  url?: string
}

export function normalizeToken(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (trimmed.length === 0) return ''

  const unquoted =
    trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1).trim() : trimmed
  const pathNormalized = unquoted.replace(/\\/g, '/')
  const basename = pathNormalized.includes('/') ? (pathNormalized.split('/').pop() ?? '') : unquoted
  let token = basename

  if (token.endsWith('.exe')) {
    token = token.slice(0, -4)
  }

  // `.app` is stripped from a bare app name (`Signal.app` → `signal`) but kept on
  // a reverse-DNS bundle id whose tail happens to be `.app` (`com.memorylane.app`),
  // so the id stays unique instead of collapsing to `com.memorylane`.
  if (token.endsWith('.app') && !token.slice(0, -4).includes('.')) {
    token = token.slice(0, -4)
  }

  const aliasLookup = token.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const alias = APP_TOKEN_ALIASES[aliasLookup]
  return alias ?? token
}

// An app's match token is its full bundle id (macOS), normalized. The whole id —
// not just the last segment — keeps it unique, so `com.microsoft.excel` blocks
// only Excel, never a sibling like `com.microsoft.word`.
export function tokenFromBundleId(bundleId: string): string {
  return normalizeToken(bundleId)
}

const APP_TOKEN_ALIASES: Record<string, string> = {
  edge: 'msedge',
  'microsoft edge': 'msedge',
  chrome: 'chrome',
  'google chrome': 'chrome',
  firefox: 'firefox',
  'mozilla firefox': 'firefox',
  brave: 'brave',
  'brave browser': 'brave',
  'whatsapp.root': 'whatsapp',
  code: 'code',
  vscode: 'code',
  'visual studio code': 'code',
}

function normalizePatternToken(value: string): string {
  return value.trim().toLowerCase()
}

// True when `token` is one of the legacy forms a previous build could have stored
// for `app`: the bundle id's last segment (`slackmacgap`), the localized/display
// name (`slack`), or an over-stripped bundle id that lost its `.app`/`.exe` tail
// (`com.memorylane` for `com.memorylane.app`).
function isLegacyTokenFor(token: string, app: InstalledApp): boolean {
  const id = app.matchToken
  return (
    id === token ||
    id.startsWith(`${token}.`) ||
    normalizeToken(id.split('.').pop() ?? '') === token ||
    normalizeToken(app.displayName) === token
  )
}

// A reverse-DNS bundle id (`com.vendor.app`) has two or more dots — the current
// macOS match-token form. Anything shorter is a legacy last-segment/display-name
// token or a Windows exe name. Expects an already-normalized token.
export function isBundleIdToken(token: string): boolean {
  return token.split('.').length - 1 >= 2
}

// Upgrade legacy excluded-app tokens to the current match token. A reverse-DNS
// bundle id is already the current form, so leave it; anything shorter is a
// legacy form and gets fuzzy-mapped to the one installed app it identifies
// (ambiguous or unknown tokens are left as-is — best-effort, never guess). On
// Windows the exe-name token resolves to itself, so this is a no-op.
export function migrateExcludedAppTokens(
  excludedApps: readonly string[],
  installedApps: readonly InstalledApp[],
): string[] {
  return excludedApps.map((entry) => {
    const token = normalizeToken(entry)
    if (isBundleIdToken(token)) return entry

    const resolved = new Set(
      installedApps.filter((app) => isLegacyTokenFor(token, app)).map((app) => app.matchToken),
    )
    return resolved.size === 1 ? [...resolved][0] : entry
  })
}

export function normalizeExcludedApps(values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values)) return []

  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    if (typeof value !== 'string') continue
    const token = normalizeToken(value)
    if (token.length === 0 || seen.has(token)) continue
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
    ? normalizeToken(window.bundleId)
    : window.processName
      ? normalizeToken(window.processName)
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
