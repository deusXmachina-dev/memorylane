export interface ExclusionWindowContext {
  processName?: string
  bundleId?: string
}

function normalizeToken(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (trimmed.length === 0) return ''

  if (trimmed.endsWith('.exe')) {
    return trimmed.slice(0, -4)
  }

  if (trimmed.endsWith('.app')) {
    return trimmed.slice(0, -4)
  }

  return trimmed
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
