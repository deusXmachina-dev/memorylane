import type { InteractionContext } from '../shared/types'
import log from './logger'
import {
  getExcludedAppMatch,
  getExcludedUrlMatch,
  getExcludedWindowTitleMatch,
  normalizeExcludedApps,
  normalizeWildcardPatterns,
} from './capture-exclusions'
import { getAnonymousModeBrowserMatch } from './capture-anonymous-mode'

export interface CaptureBlacklistCoordinator {
  handleInteraction(event: InteractionContext): void
  updateExclusions(exclusions: {
    apps: string[]
    windowTitlePatterns: string[]
    urlPatterns: string[]
    excludePrivateBrowsing: boolean
  }): void
  /** The org's centrally-synced blacklist (enterprise). Unioned with the user's
   * own exclusions for app/URL matching; window titles and private browsing are
   * user-only and unaffected. */
  setManagedExclusions(managed: { apps: string[]; urlPatterns: string[] }): void
}

export function createCaptureBlacklistCoordinator(params: {
  initialExcludedApps?: string[]
  initialExcludedWindowTitlePatterns?: string[]
  initialExcludedUrlPatterns?: string[]
  initialExcludePrivateBrowsing?: boolean
  onPrivacyBlockingChanged?: (blocked: boolean) => void
  forwardInteraction: (event: InteractionContext) => void
  flushEvents: () => void
  setScreenshotsSuppressed: (suppressed: boolean) => void
}): CaptureBlacklistCoordinator {
  // Two layers — the device user's own exclusions and the org's centrally-synced
  // ones. Effective apps/URLs (used for matching) are the union of both,
  // recomputed whenever either layer changes. Window titles and private browsing
  // are user-only; the managed layer never contributes them.
  let userExcludedApps = normalizeExcludedApps(params.initialExcludedApps)
  let userExcludedUrlPatterns = normalizeWildcardPatterns(params.initialExcludedUrlPatterns)
  let managedExcludedApps: string[] = []
  let managedExcludedUrlPatterns: string[] = []
  let excludedWindowTitlePatterns = normalizeWildcardPatterns(
    params.initialExcludedWindowTitlePatterns,
  )
  let excludePrivateBrowsing = params.initialExcludePrivateBrowsing ?? true

  let excludedApps = new Set<string>()
  let excludedUrlPatterns: string[] = []
  const recomputeEffective = (): void => {
    excludedApps = new Set([...userExcludedApps, ...managedExcludedApps])
    excludedUrlPatterns = [...new Set([...userExcludedUrlPatterns, ...managedExcludedUrlPatterns])]
  }
  recomputeEffective()
  let blockedByExcludedApp = false
  let blockedByExcludedWindowTitle = false
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
    excludedWindowTitleMatch: string | null,
    excludedUrlMatch: string | null,
    anonymousModeMatch: string | null,
    reason: string,
  ): void => {
    const nextBlockedByExcludedApp = excludedAppMatch !== null
    const nextBlockedByExcludedWindowTitle = excludedWindowTitleMatch !== null
    const nextBlockedByExcludedUrl = excludedUrlMatch !== null
    const nextBlockedByAnonymousBrowser = anonymousModeMatch !== null
    const wasBlocked =
      blockedByExcludedApp ||
      blockedByExcludedWindowTitle ||
      blockedByExcludedUrl ||
      blockedByAnonymousBrowser
    const blocked =
      nextBlockedByExcludedApp ||
      nextBlockedByExcludedWindowTitle ||
      nextBlockedByExcludedUrl ||
      nextBlockedByAnonymousBrowser

    blockedByExcludedApp = nextBlockedByExcludedApp
    blockedByExcludedWindowTitle = nextBlockedByExcludedWindowTitle
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
      if (excludedWindowTitleMatch !== null) {
        details.push(`excluded_window_title=${excludedWindowTitleMatch}`)
      }
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
    const excludedWindowTitleMatch = getExcludedWindowTitleMatch(
      activeWindow,
      excludedWindowTitlePatterns,
    )
    const excludedUrlMatch = getExcludedUrlMatch(activeWindow, excludedUrlPatterns)
    const detectedAnonymousModeMatch = excludePrivateBrowsing
      ? getAnonymousModeBrowserMatch(activeWindow)
      : null
    const anonymousModeMatch = resolveAnonymousModeMatch(activeWindow, detectedAnonymousModeMatch)
    setBlocked(
      excludedAppMatch,
      excludedWindowTitleMatch,
      excludedUrlMatch,
      anonymousModeMatch,
      reason,
    )
    return (
      excludedAppMatch === null &&
      excludedWindowTitleMatch === null &&
      excludedUrlMatch === null &&
      anonymousModeMatch === null
    )
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

      if (
        blockedByExcludedApp ||
        blockedByExcludedWindowTitle ||
        blockedByExcludedUrl ||
        blockedByAnonymousBrowser
      ) {
        return
      }
      params.forwardInteraction(event)
    },
    updateExclusions(exclusions): void {
      userExcludedApps = normalizeExcludedApps(exclusions.apps)
      excludedWindowTitlePatterns = normalizeWildcardPatterns(exclusions.windowTitlePatterns)
      userExcludedUrlPatterns = normalizeWildcardPatterns(exclusions.urlPatterns)
      excludePrivateBrowsing = exclusions.excludePrivateBrowsing
      if (!excludePrivateBrowsing) {
        privateBrowserWindowHandles.clear()
      }
      recomputeEffective()
      reconcileBlockingState('settings_update', lastActiveWindow)
    },
    setManagedExclusions(managed): void {
      managedExcludedApps = normalizeExcludedApps(managed.apps)
      managedExcludedUrlPatterns = normalizeWildcardPatterns(managed.urlPatterns)
      recomputeEffective()
      reconcileBlockingState('managed_update', lastActiveWindow)
    },
  }
}
