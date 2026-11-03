// Browser bundle IDs (apps where TLD changes create activity boundaries)
const BROWSER_BUNDLE_IDS = new Set([
  'com.apple.Safari',
  'com.google.Chrome',
  'com.google.Chrome.canary',
  'org.chromium.Chromium',
  'com.brave.Browser',
  'com.microsoft.edgemac',
  'com.operasoftware.Opera',
  'com.vivaldi.Vivaldi',
  'company.thebrowser.Browser', // Arc
  'org.mozilla.firefox',
  'org.mozilla.firefoxdeveloperedition',
  'com.sigmaos.sigmaos',
  'org.webkit.MiniBrowser',
])

// Transient apps that shouldn't end the current activity (brief overlays)
const TRANSIENT_APP_BUNDLE_IDS = new Set([
  'com.apple.Spotlight',
  'com.apple.notificationcenterui',
  'com.apple.controlcenter',
  'com.apple.screencaptureui',
  'com.apple.ScreenSaver.Engine',
  'com.apple.loginwindow',
])

// Browser process names for platforms without bundle IDs
const BROWSER_PROCESS_NAMES = new Set([
  'Google Chrome',
  'Chromium',
  'Brave Browser',
  'Microsoft Edge',
  'Opera',
  'Vivaldi',
  'Firefox',
  'Safari',
  'Arc',
  // Windows executable names (without .exe)
  'chrome',
  'msedge',
  'brave',
  'opera',
  'vivaldi',
  'firefox',
])

// Hostnames that aren't real websites (browser-internal pages).
// Filtered out of the user-visible seen-domains picker and observation collection,
// but NOT from extractTld itself — it's used for activity-boundary detection where
// these transitions are still a legitimate signal.
export const NON_WEBSITE_HOSTS = new Set(['newtab'])

// Transient app process names for platforms without bundle IDs
const TRANSIENT_PROCESS_NAMES = new Set([
  // Windows equivalents
  'SearchUI',
  'SearchApp',
  'ShellExperienceHost',
  'ActionCenter',
])

export function isBrowserApp(app: { bundleId?: string; processName: string }): boolean {
  if (app.bundleId && BROWSER_BUNDLE_IDS.has(app.bundleId)) return true
  return BROWSER_PROCESS_NAMES.has(app.processName)
}

/**
 * The app identity of an activity: the website host for web work
 * ("dashboard.stripe.com"), the app name otherwise. Computed at retrieval —
 * raw app_name/tld stay as captured.
 */
export function activityAppIdentity(a: { appName: string; tld: string | null }): string {
  const host = (a.tld ?? '').toLowerCase()
  if (host !== '' && !NON_WEBSITE_HOSTS.has(host)) {
    return host.startsWith('www.') ? host.slice(4) : host
  }
  return a.appName
}

/** Unique app identities of a sighting's activities; browser names only when the run has nothing else. */
export function deriveSightingApps(activities: readonly { appName: string }[]): string[] {
  const apps = [...new Set(activities.map((a) => a.appName).filter((name) => name !== ''))]
  const nonBrowser = apps.filter((name) => !isBrowserApp({ processName: name }))
  return nonBrowser.length > 0 ? nonBrowser : apps
}

export function isTransientApp(app: { bundleId?: string; processName: string }): boolean {
  if (app.bundleId && TRANSIENT_APP_BUNDLE_IDS.has(app.bundleId)) return true
  return TRANSIENT_PROCESS_NAMES.has(app.processName)
}

export function normalizeAppToken(value: string): string {
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

export const SELF_APP_TOKENS: readonly string[] = [
  'memorylane',
  'memorylane enterprise',
  'dev.deusxmachina.memorylane',
  'com.memorylane.app',
  'com.memorylane.enterprise',
]

const SELF_APP_TOKEN_SET = new Set(SELF_APP_TOKENS)

export function isSelfAppToken(token: string): boolean {
  return SELF_APP_TOKEN_SET.has(normalizeAppToken(token))
}
