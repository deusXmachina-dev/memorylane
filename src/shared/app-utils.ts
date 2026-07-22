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
 * ("dashboard.stripe.com"), the application name for desktop work ("Ghostty").
 * Computed at retrieval — raw app_name/tld stay as captured.
 */
export function activityAppIdentity(a: { appName: string; tld: string | null }): string {
  const host = (a.tld ?? '').toLowerCase()
  if (host !== '' && !NON_WEBSITE_HOSTS.has(host)) {
    return host.startsWith('www.') ? host.slice(4) : host
  }
  return a.appName
}

/**
 * App identities for a sighting, derived from its cited activities. Deduped,
 * first-appearance order. Bare browser names (a browser on an internal page)
 * are kept only when the run has no other identity at all.
 */
export function deriveSightingApps(
  activities: readonly { appName: string; tld: string | null }[],
): string[] {
  const identities = [
    ...new Set(activities.map(activityAppIdentity).filter((identity) => identity !== '')),
  ]
  const nonBrowser = identities.filter((identity) => !isBrowserApp({ processName: identity }))
  return nonBrowser.length > 0 ? nonBrowser : identities
}

export function isTransientApp(app: { bundleId?: string; processName: string }): boolean {
  if (app.bundleId && TRANSIENT_APP_BUNDLE_IDS.has(app.bundleId)) return true
  return TRANSIENT_PROCESS_NAMES.has(app.processName)
}
