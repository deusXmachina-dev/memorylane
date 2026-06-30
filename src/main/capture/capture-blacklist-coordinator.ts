import type { InteractionContext } from '@/shared/types'
import log from '@main/utils/logger'
import {
  getExcludedAppMatch,
  getExcludedUrlMatch,
  normalizeExcludedApps,
  normalizeWildcardPatterns,
} from './capture-exclusions'
import { getAnonymousModeBrowserMatch } from './capture-anonymous-mode'
import { normalizeUrlPattern } from '@/shared/url-utils'

export interface CaptureBlacklistCoordinator {
  handleInteraction(event: InteractionContext): void
  updateExclusions(exclusions: {
    apps: string[]
    urlPatterns: string[]
    excludePrivateBrowsing: boolean
  }): void
  /** The org's centrally-synced blacklist (enterprise). Unioned with the user's
   * own exclusions for app/URL matching; private browsing stays user-only. */
  setManagedExclusions(managed: { apps: string[]; urlPatterns: string[] }): void
}

export function createCaptureBlacklistCoordinator(params: {
  initialExcludedApps?: string[]
  initialExcludedUrlPatterns?: string[]
  initialExcludePrivateBrowsing?: boolean
  onPrivacyBlockingChanged?: (blocked: boolean) => void
  forwardInteraction: (event: InteractionContext) => void
  flushEvents: () => void
  setScreenshotsSuppressed: (suppressed: boolean) => void
}): CaptureBlacklistCoordinator {
  // Two layers — the device user's own exclusions and the org's centrally-synced
  // ones. Effective apps/URLs (used for matching) are the union of both,
  // recomputed whenever either layer changes. Private browsing is user-only; the
  // managed layer never contributes it.
  // Every entry path runs through normalizeUrlPattern (a wildcard kept verbatim,
  // a domain reduced to its bare host). It returns '' for a degenerate match-all
  // wildcard, so empties are filtered before the patterns reach the matcher.
  const normalizeUrlPatterns = (values: readonly string[] | undefined): string[] =>
    normalizeWildcardPatterns(values).map(normalizeUrlPattern).filter(Boolean)

  let userExcludedApps = normalizeExcludedApps(params.initialExcludedApps)
  let userExcludedUrlPatterns = normalizeUrlPatterns(params.initialExcludedUrlPatterns)
  let managedExcludedApps: string[] = []
  let managedExcludedUrlPatterns: string[] = []
  let excludePrivateBrowsing = params.initialExcludePrivateBrowsing ?? true

  let excludedApps = new Set<string>()
  let excludedUrlPatterns: string[] = []
  const recomputeEffective = (): void => {
    excludedApps = new Set([...userExcludedApps, ...managedExcludedApps])
    excludedUrlPatterns = [...new Set([...userExcludedUrlPatterns, ...managedExcludedUrlPatterns])]
  }
  recomputeEffective()
  let blockedByExcludedApp = false
  let blockedByExcludedUrl = false
  let blockedByAnonymousBrowser = false
  const privateBrowserWindowHandles = new Set<string>()
  let lastActiveWindow: InteractionContext['activeWindow'] | undefined

  const getWindowHandle = (activeWindow: InteractionContext['activeWindow']): string | null => {
    const hwnd = activeWindow?.hwnd?.trim()
    if (!hwnd) return null
    return hwnd
  }

  const resolveAnonymousModeMatch = (
    activeWindow: InteractionContext['activeWindow'],
    detectedAnonymousModeMatch: string | null,
  ): string | null => {
    if (!excludePrivateBrowsing) return null

    const hwnd = getWindowHandle(activeWindow)
    if (detectedAnonymousModeMatch !== null) {
      if (hwnd !== null) {
        privateBrowserWindowHandles.add(hwnd)
      }
      return detectedAnonymousModeMatch
    }

    if (hwnd !== null && privateBrowserWindowHandles.has(hwnd)) {
      return `hwnd=${hwnd}`
    }

    return null
  }

  const setBlocked = (
    excludedAppMatch: string | null,
    excludedUrlMatch: string | null,
    anonymousModeMatch: string | null,
    reason: string,
  ): void => {
    const nextBlockedByExcludedApp = excludedAppMatch !== null
    const nextBlockedByExcludedUrl = excludedUrlMatch !== null
    const nextBlockedByAnonymousBrowser = anonymousModeMatch !== null
    const wasBlocked = blockedByExcludedApp || blockedByExcludedUrl || blockedByAnonymousBrowser
    const blocked =
      nextBlockedByExcludedApp || nextBlockedByExcludedUrl || nextBlockedByAnonymousBrowser

    blockedByExcludedApp = nextBlockedByExcludedApp
    blockedByExcludedUrl = nextBlockedByExcludedUrl
    blockedByAnonymousBrowser = nextBlockedByAnonymousBrowser

    if (wasBlocked !== blocked) {
      params.onPrivacyBlockingChanged?.(blocked)
    }

    if (wasBlocked === blocked) return
    params.setScreenshotsSuppressed(blocked)

    if (blocked) {
      params.flushEvents()
      const details: string[] = []
      if (excludedAppMatch !== null) details.push(`excluded_app=${excludedAppMatch}`)
      if (excludedUrlMatch !== null) details.push(`excluded_url=${excludedUrlMatch}`)
      if (anonymousModeMatch !== null) details.push(`anonymous_mode=${anonymousModeMatch}`)
      log.info(`[Blacklist] Entering blocked mode (${reason}: ${details.join(', ')})`)
      return
    }

    log.info(`[Blacklist] Leaving blocked mode (${reason})`)
  }

  const reconcileBlockingState = (
    reason: string,
    activeWindow: InteractionContext['activeWindow'],
  ): boolean => {
    const excludedAppMatch = getExcludedAppMatch(activeWindow, excludedApps)
    const excludedUrlMatch = getExcludedUrlMatch(activeWindow, excludedUrlPatterns)
    const detectedAnonymousModeMatch = excludePrivateBrowsing
      ? getAnonymousModeBrowserMatch(activeWindow)
      : null
    const anonymousModeMatch = resolveAnonymousModeMatch(activeWindow, detectedAnonymousModeMatch)
    log.debug(
      `[Blacklist] reconcile reason=${reason} url=${activeWindow?.url ?? '(none)'} ` +
        `urlMatch=${excludedUrlMatch ?? '(none)'} appMatch=${excludedAppMatch ?? '(none)'} ` +
        `anon=${anonymousModeMatch ?? '(none)'} urlPatterns=${excludedUrlPatterns.length}`,
    )
    setBlocked(excludedAppMatch, excludedUrlMatch, anonymousModeMatch, reason)
    return excludedAppMatch === null && excludedUrlMatch === null && anonymousModeMatch === null
  }

  return {
    handleInteraction(event: InteractionContext): void {
      if (event.type === 'app_change') {
        lastActiveWindow = event.activeWindow
        if (!reconcileBlockingState('app_change', event.activeWindow)) {
          return
        }

        params.forwardInteraction(event)
        return
      }

      if (blockedByExcludedApp || blockedByExcludedUrl || blockedByAnonymousBrowser) {
        return
      }
      params.forwardInteraction(event)
    },
    updateExclusions(exclusions): void {
      userExcludedApps = normalizeExcludedApps(exclusions.apps)
      userExcludedUrlPatterns = normalizeUrlPatterns(exclusions.urlPatterns)
      excludePrivateBrowsing = exclusions.excludePrivateBrowsing
      if (!excludePrivateBrowsing) {
        privateBrowserWindowHandles.clear()
      }
      recomputeEffective()
      reconcileBlockingState('settings_update', lastActiveWindow)
    },
    setManagedExclusions(managed): void {
      managedExcludedApps = normalizeExcludedApps(managed.apps)
      managedExcludedUrlPatterns = normalizeUrlPatterns(managed.urlPatterns)
      recomputeEffective()
      reconcileBlockingState('managed_update', lastActiveWindow)
    },
  }
}
