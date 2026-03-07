import type { InteractionContext } from '../shared/types'
import log from './logger'
import { getExcludedAppMatch, normalizeExcludedApps } from './capture-exclusions'

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
  let lastActiveWindow: InteractionContext['activeWindow'] | undefined

  const setBlocked = (blocked: boolean, reason: string, match?: string): void => {
    if (blockedByExcludedApp === blocked) return
    blockedByExcludedApp = blocked
    params.setScreenshotsSuppressed(blocked)

    if (blocked) {
      params.flushEvents()
      log.info(`[Blacklist] Entering excluded app mode (${reason}${match ? `: ${match}` : ''})`)
      return
    }

    log.info(`[Blacklist] Leaving excluded app mode (${reason})`)
  }

  return {
    handleInteraction(event: InteractionContext): void {
      if (event.type === 'app_change') {
        lastActiveWindow = event.activeWindow
        const match = getExcludedAppMatch(event.activeWindow, excludedApps)
        if (match !== null) {
          setBlocked(true, 'app_change', match)
          return
        }

        setBlocked(false, 'app_change')
        params.forwardInteraction(event)
        return
      }

      if (blockedByExcludedApp) return
      params.forwardInteraction(event)
    },
    updateExcludedApps(apps: string[]): void {
      excludedApps = new Set(normalizeExcludedApps(apps))
      const match = getExcludedAppMatch(lastActiveWindow, excludedApps)
      if (match !== null) {
        setBlocked(true, 'settings_update', match)
        return
      }

      setBlocked(false, 'settings_update')
    },
  }
}
