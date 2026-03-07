import type { InteractionContext } from '../shared/types'
import log from './logger'
import { getExcludedAppMatch, normalizeExcludedApps } from './capture-exclusions'
import { getAnonymousModeBrowserMatch } from './capture-anonymous-mode'

export interface CaptureBlacklistCoordinator {
  handleInteraction(event: InteractionContext): void
  updateExcludedApps(apps: string[]): void
}

export function createCaptureBlacklistCoordinator(params: {
  initialExcludedApps?: string[]
  forwardInteraction: (event: InteractionContext) => void
  flushEvents: () => void
  setScreenshotsSuppressed: (suppressed: boolean) => void
}): CaptureBlacklistCoordinator {
  let excludedApps = new Set(normalizeExcludedApps(params.initialExcludedApps))
  let blockedByExcludedApp = false
  let blockedByAnonymousBrowser = false
  let lastActiveWindow: InteractionContext['activeWindow'] | undefined

  const setBlocked = (
    excludedAppMatch: string | null,
    anonymousModeMatch: string | null,
    reason: string,
  ): void => {
    const nextBlockedByExcludedApp = excludedAppMatch !== null
    const nextBlockedByAnonymousBrowser = anonymousModeMatch !== null
    const wasBlocked = blockedByExcludedApp || blockedByAnonymousBrowser
    const blocked = nextBlockedByExcludedApp || nextBlockedByAnonymousBrowser

    blockedByExcludedApp = nextBlockedByExcludedApp
    blockedByAnonymousBrowser = nextBlockedByAnonymousBrowser

    if (wasBlocked === blocked) return
    params.setScreenshotsSuppressed(blocked)

    if (blocked) {
      params.flushEvents()
      const details: string[] = []
      if (excludedAppMatch !== null) details.push(`excluded_app=${excludedAppMatch}`)
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
    const anonymousModeMatch = getAnonymousModeBrowserMatch(activeWindow)
    setBlocked(excludedAppMatch, anonymousModeMatch, reason)
    return excludedAppMatch === null && anonymousModeMatch === null
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

      if (blockedByExcludedApp || blockedByAnonymousBrowser) return
      params.forwardInteraction(event)
    },
    updateExcludedApps(apps: string[]): void {
      excludedApps = new Set(normalizeExcludedApps(apps))
      reconcileBlockingState('settings_update', lastActiveWindow)
    },
  }
}
