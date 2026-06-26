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

  if (token.endsWith('.app')) {
    token = token.slice(0, -4)
  }

  const aliasLookup = token.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const alias = APP_TOKEN_ALIASES[aliasLookup]
  return alias ?? token
}

export function tokenFromBundleId(bundleId: string): string {
  const last = bundleId.split('.').pop() ?? bundleId
  return normalizeToken(last)
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

const urlRegexCache = new Map<string, RegExp>()

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// URL patterns match "starts-with" against the full (scheme-qualified) URL.
// `*` (any text) and `?` (one char) are explicit wildcards; a pattern with
// neither is a literal prefix. The start is anchored, the end stays open.
function urlPatternToRegex(pattern: string): RegExp {
  const cached = urlRegexCache.get(pattern)
  if (cached) return cached

  const body = escapeRegex(pattern).replace(/\\\*/g, '.*').replace(/\\\?/g, '.')
  const regex = new RegExp(`^${body}`)
  urlRegexCache.set(pattern, regex)
  return regex
}

function getWildcardMatch(value: string | undefined, patterns: readonly string[]): string | null {
  if (!value || patterns.length === 0) return null
  const normalizedValue = normalizePatternToken(value)
  if (normalizedValue.length === 0) return null

  for (const pattern of patterns) {
    if (urlPatternToRegex(pattern).test(normalizedValue)) {
      return pattern
    }
  }

  return null
}

function collectCandidates(window: ExclusionWindowContext | undefined): string[] {
  if (!window) return []

  const candidates: string[] = []

  if (window.processName) {
    candidates.push(normalizeToken(window.processName))
  }

  if (window.bundleId) {
    const normalizedBundleId = normalizeToken(window.bundleId)
    candidates.push(normalizedBundleId)

    const bundleIdParts = normalizedBundleId.split('.')
    const lastPart = bundleIdParts[bundleIdParts.length - 1]
    if (lastPart) {
      candidates.push(lastPart)
    }
  }

  return candidates.filter((candidate) => candidate.length > 0)
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

export function getExcludedUrlMatch(
  window: ExclusionWindowContext | undefined,
  patterns: readonly string[],
): string | null {
  return getWildcardMatch(window?.url, patterns)
}
