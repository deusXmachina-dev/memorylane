import type { InteractionContext } from '../../shared/types'
import log from '../logger'
import {
  getExcludedAppMatch,
  getExcludedUrlMatch,
  normalizeExcludedApps,
  normalizeWildcardPatterns,
} from '../capture-exclusions'
import { getAnonymousModeBrowserMatch } from '../capture-anonymous-mode'
import { normalizeUrlPattern } from '../../shared/url-utils'
import type { Blacklist } from './blacklist'
import type { LocalBlacklist } from './local-blacklist'

export interface BlacklistCoordinatorDeps {
  onPrivacyBlockingChanged?: (blocked: boolean) => void
  forwardInteraction: (event: InteractionContext) => void
  flushEvents: () => void
  setScreenshotsSuppressed: (suppressed: boolean) => void
}

// URL patterns match starts-with against the full URL, so every entry path runs
// through normalizeUrlPattern (which prepends https:// to a bare host).
const normalizeUrlPatterns = (values: readonly string[] | undefined): string[] =>
  normalizeWildcardPatterns(values).map(normalizeUrlPattern)

/**
 * Merges the device user's own exclusions ({@link LocalBlacklist}) with the
 * org's centrally-synced ones ({@link RemoteBlacklist}, enterprise only) and
 * applies the union to the capture pipeline: a matching foreground app/URL — or
 * a private-browsing window — suppresses screenshots and drops events.
 *
 * Effective apps/URLs are the union of both sources, recomputed whenever either
 * emits. Private browsing is user-only; the managed source never contributes it.
 */
export class BlacklistCoordinator {
  private excludedApps = new Set<string>()
  private excludedUrlPatterns: string[] = []
  private excludePrivateBrowsing: boolean
  private blockedByExcludedApp = false
  private blockedByExcludedUrl = false
  private blockedByAnonymousBrowser = false
  private readonly privateBrowserWindowHandles = new Set<string>()
  private lastActiveWindow: InteractionContext['activeWindow'] | undefined
  private readonly unsubscribes: Array<() => void> = []

  constructor(
    private readonly local: LocalBlacklist,
    private readonly remote: Blacklist | null,
    private readonly deps: BlacklistCoordinatorDeps,
  ) {
    this.excludePrivateBrowsing = local.getExcludePrivateBrowsing()
    this.unsubscribes.push(local.onChange(() => this.recompute('settings_update')))
    if (remote) {
      this.unsubscribes.push(remote.onChange(() => this.recompute('managed_update')))
    }
    this.recompute('init')
  }

  handleInteraction(event: InteractionContext): void {
    if (event.type === 'app_change') {
      this.lastActiveWindow = event.activeWindow
      if (!this.reconcileBlockingState('app_change', event.activeWindow)) {
        return
      }
      this.deps.forwardInteraction(event)
      return
    }

    if (this.blockedByExcludedApp || this.blockedByExcludedUrl || this.blockedByAnonymousBrowser) {
      return
    }
    this.deps.forwardInteraction(event)
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe()
    this.unsubscribes.length = 0
  }

  /** Pulls the raw lists from both sources, normalizes + unions them for
   * matching, then reconciles the blocking state against the current window. */
  private recompute(reason: string): void {
    const userApps = normalizeExcludedApps(this.local.getBlacklistedApps())
    const userUrlPatterns = normalizeUrlPatterns(this.local.getBlacklistedUrls())
    const managedApps = normalizeExcludedApps(this.remote?.getBlacklistedApps() ?? [])
    const managedUrlPatterns = normalizeUrlPatterns(this.remote?.getBlacklistedUrls() ?? [])

    this.excludePrivateBrowsing = this.local.getExcludePrivateBrowsing()
    if (!this.excludePrivateBrowsing) {
      this.privateBrowserWindowHandles.clear()
    }

    this.excludedApps = new Set([...userApps, ...managedApps])
    this.excludedUrlPatterns = [...new Set([...userUrlPatterns, ...managedUrlPatterns])]
    this.reconcileBlockingState(reason, this.lastActiveWindow)
  }

  private getWindowHandle(activeWindow: InteractionContext['activeWindow']): string | null {
    const hwnd = activeWindow?.hwnd?.trim()
    if (!hwnd) return null
    return hwnd
  }

  private resolveAnonymousModeMatch(
    activeWindow: InteractionContext['activeWindow'],
    detectedAnonymousModeMatch: string | null,
  ): string | null {
    if (!this.excludePrivateBrowsing) return null

    const hwnd = this.getWindowHandle(activeWindow)
    if (detectedAnonymousModeMatch !== null) {
      if (hwnd !== null) {
        this.privateBrowserWindowHandles.add(hwnd)
      }
      return detectedAnonymousModeMatch
    }

    if (hwnd !== null && this.privateBrowserWindowHandles.has(hwnd)) {
      return `hwnd=${hwnd}`
    }

    return null
  }

  private setBlocked(
    excludedAppMatch: string | null,
    excludedUrlMatch: string | null,
    anonymousModeMatch: string | null,
    reason: string,
  ): void {
    const nextBlockedByExcludedApp = excludedAppMatch !== null
    const nextBlockedByExcludedUrl = excludedUrlMatch !== null
    const nextBlockedByAnonymousBrowser = anonymousModeMatch !== null
    const wasBlocked =
      this.blockedByExcludedApp || this.blockedByExcludedUrl || this.blockedByAnonymousBrowser
    const blocked =
      nextBlockedByExcludedApp || nextBlockedByExcludedUrl || nextBlockedByAnonymousBrowser

    this.blockedByExcludedApp = nextBlockedByExcludedApp
    this.blockedByExcludedUrl = nextBlockedByExcludedUrl
    this.blockedByAnonymousBrowser = nextBlockedByAnonymousBrowser

    if (wasBlocked !== blocked) {
      this.deps.onPrivacyBlockingChanged?.(blocked)
    }

    if (wasBlocked === blocked) return
    this.deps.setScreenshotsSuppressed(blocked)

    if (blocked) {
      this.deps.flushEvents()
      const details: string[] = []
      if (excludedAppMatch !== null) details.push(`excluded_app=${excludedAppMatch}`)
      if (excludedUrlMatch !== null) details.push(`excluded_url=${excludedUrlMatch}`)
      if (anonymousModeMatch !== null) details.push(`anonymous_mode=${anonymousModeMatch}`)
      log.info(`[Blacklist] Entering blocked mode (${reason}: ${details.join(', ')})`)
      return
    }

    log.info(`[Blacklist] Leaving blocked mode (${reason})`)
  }

  private reconcileBlockingState(
    reason: string,
    activeWindow: InteractionContext['activeWindow'],
  ): boolean {
    const excludedAppMatch = getExcludedAppMatch(activeWindow, this.excludedApps)
    const excludedUrlMatch = getExcludedUrlMatch(activeWindow, this.excludedUrlPatterns)
    const detectedAnonymousModeMatch = this.excludePrivateBrowsing
      ? getAnonymousModeBrowserMatch(activeWindow)
      : null
    const anonymousModeMatch = this.resolveAnonymousModeMatch(
      activeWindow,
      detectedAnonymousModeMatch,
    )
    this.setBlocked(excludedAppMatch, excludedUrlMatch, anonymousModeMatch, reason)
    return excludedAppMatch === null && excludedUrlMatch === null && anonymousModeMatch === null
  }
}
