export interface AnonymousModeWindowContext {
  processName?: string
  bundleId?: string
  title?: string
  url?: string
}

const BROWSER_MARKERS = [
  'chrome',
  'chromium',
  'thorium',
  'brave',
  'edge',
  'iexplore',
  'vivaldi',
  'opera',
  'arc',
  'comet',
  'dia browser',
  'sigmaos',
  'wavebox',
  'whale',
  'yandex',
  'maxthon',
  'duckduckgo',
  'ghostery',
  'safari',
  'orion',
  'kagi',
  'epiphany',
  'falkon',
  'qutebrowser',
  'midori',
  'firefox',
  'waterfox',
  'librewolf',
  'floorp',
  'mullvad',
  'palemoon',
  'pale moon',
  'seamonkey',
  'tor browser',
  'zen',
]

const ANONYMOUS_MODE_MARKERS = [
  'incognito',
  'inprivate',
  'in private',
  'incognito mode',
  'inprivate browsing',
  'private browsing',
  'private window',
  'private tab',
  'private mode',
  'edge://inprivate',
  'about:privatebrowsing',
  'about:incognito',
]

export function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

export function normalizeProcessName(value: string | undefined): string {
  const normalized = normalize(value)
  if (normalized.endsWith('.exe')) {
    return normalized.slice(0, -4)
  }

  if (normalized.endsWith('.app')) {
    return normalized.slice(0, -4)
  }

  return normalized
}

function isLikelyBrowser(window: AnonymousModeWindowContext): boolean {
  const processName = normalizeProcessName(window.processName)
  const bundleId = normalize(window.bundleId)

  return BROWSER_MARKERS.some((marker) => processName.includes(marker) || bundleId.includes(marker))
}

function findAnonymousModeMarker(window: AnonymousModeWindowContext): string | null {
  const title = normalize(window.title)
  const url = normalize(window.url)

  for (const marker of ANONYMOUS_MODE_MARKERS) {
    if (title.includes(marker) || url.includes(marker)) {
      return marker
    }
  }

  return null
}

export function getAnonymousModeBrowserMatch(
  window: AnonymousModeWindowContext | undefined,
): string | null {
  if (!window) return null
  if (!isLikelyBrowser(window)) return null
  return findAnonymousModeMarker(window)
}
