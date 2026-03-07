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
}

export function createCaptureBlacklistCoordinator(params: {
  initialExcludedApps?: string[]
  initialExcludedWindowTitlePatterns?: string[]
  initialExcludedUrlPatterns?: string[]
  initialExcludePrivateBrowsing?: boolean
  forwardInteraction: (event: InteractionContext) => void
  flushEvents: () => void
  setScreenshotsSuppressed: (suppressed: boolean) => void
}): CaptureBlacklistCoordinator {
  let excludedApps = new Set(normalizeExcludedApps(params.initialExcludedApps))
  let excludedWindowTitlePatterns = normalizeWildcardPatterns(
    params.initialExcludedWindowTitlePatterns,
  )
  let excludedUrlPatterns = normalizeWildcardPatterns(params.initialExcludedUrlPatterns)
  let excludePrivateBrowsing = params.initialExcludePrivateBrowsing ?? true
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
      excludedApps = new Set(normalizeExcludedApps(exclusions.apps))
      excludedWindowTitlePatterns = normalizeWildcardPatterns(exclusions.windowTitlePatterns)
      excludedUrlPatterns = normalizeWildcardPatterns(exclusions.urlPatterns)
      excludePrivateBrowsing = exclusions.excludePrivateBrowsing
      if (!excludePrivateBrowsing) {
        privateBrowserWindowHandles.clear()
      }
      reconcileBlockingState('settings_update', lastActiveWindow)
    },
  }
}
