import { addAppWatcherListener, AppWatcherEvent } from '@main/recorder/app-watcher'
import { appToken, isSelfApp } from './capture-exclusions'
import { extractTld } from '@main/recorder/tld-utils'
import { NON_WEBSITE_HOSTS, isBrowserApp } from '@/shared/app-utils'
import type { ObservationState } from '@/shared/types'
import log from '@main/utils/logger'

interface CaptureSuppressor {
  setFrameCaptureSuppressed(suppressed: boolean): Promise<void>
}

const DEFAULT_DURATION_MS = 120_000
const MIN_DURATION_MS = 5_000
const MAX_DURATION_MS = 30 * 60_000

export interface ObservationController {
  start(durationMs: number): ObservationState
  stop(reason: 'user' | 'timer'): ObservationState
  getState(): ObservationState
  dispose(): void
}

interface ControllerParams {
  captureControl: CaptureSuppressor
  onUpdate: (state: ObservationState) => void
}

export function createObservationController(params: ControllerParams): ObservationController {
  let phase: 'idle' | 'running' = 'idle'
  let endsAt: number | null = null
  let apps = new Set<string>()
  let urls = new Set<string>()
  let unsubscribe: (() => void) | null = null
  let endTimer: NodeJS.Timeout | null = null
  let lastRun: ObservationState['lastRun'] | undefined

  const getState = (): ObservationState => ({
    phase,
    endsAt: phase === 'running' ? endsAt : null,
    appsCount: apps.size,
    urlsCount: urls.size,
    lastRun,
  })

  const emit = (): void => {
    try {
      params.onUpdate(getState())
    } catch (error) {
      log.warn('[Observation] onUpdate listener threw:', error)
    }
  }

  const handleEvent = (event: AppWatcherEvent): void => {
    if (event.type !== 'app_change' && event.type !== 'window_change') return
    if (isSelfApp(event)) return

    let changed = false

    const browser = isBrowserApp({ bundleId: event.bundleId, processName: event.app ?? '' })

    if (!browser) {
      const token = appToken(event)
      if (token && !apps.has(token)) {
        apps.add(token)
        changed = true
      }
    }

    const host = extractTld(event.url)
    if (host) {
      const normalized = host.toLowerCase()
      if (!NON_WEBSITE_HOSTS.has(normalized) && !urls.has(normalized)) {
        urls.add(normalized)
        changed = true
      }
    }

    if (changed) emit()
  }

  const stop = (reason: 'user' | 'timer'): ObservationState => {
    if (phase !== 'running') return getState()

    // Flip phase + unsuppress capture first, so a throw below cannot leave the
    // controller stuck in 'running' or capture permanently disabled.
    phase = 'idle'
    endsAt = null

    if (endTimer) {
      clearTimeout(endTimer)
      endTimer = null
    }

    void params.captureControl.setFrameCaptureSuppressed(false).catch((error) => {
      log.error('[Observation] setFrameCaptureSuppressed(false) failed:', error)
    })

    if (unsubscribe) {
      try {
        unsubscribe()
      } catch (error) {
        log.error('[Observation] app-watcher unsubscribe threw:', error)
      }
      unsubscribe = null
    }

    const collectedApps = [...apps]
    const collectedUrls = [...urls]
    const appsAdded = collectedApps.length
    const urlsAdded = collectedUrls.length

    lastRun = {
      appsAdded,
      urlsAdded,
      apps: collectedApps,
      urls: collectedUrls,
      at: Date.now(),
    }
    log.info(`[Observation] Stopped (reason=${reason}, apps=${appsAdded}, urls=${urlsAdded})`)
    emit()
    return getState()
  }

  const start = (requestedDurationMs: number): ObservationState => {
    if (phase === 'running') return getState()

    const clamped = Math.max(
      MIN_DURATION_MS,
      Math.min(
        MAX_DURATION_MS,
        Number.isFinite(requestedDurationMs) && requestedDurationMs > 0
          ? Math.floor(requestedDurationMs)
          : DEFAULT_DURATION_MS,
      ),
    )

    apps = new Set<string>()
    urls = new Set<string>()
    endsAt = Date.now() + clamped
    phase = 'running'

    try {
      unsubscribe = addAppWatcherListener(handleEvent)
    } catch (error) {
      log.error('[Observation] Failed to subscribe to app-watcher:', error)
      phase = 'idle'
      endsAt = null
      throw error
    }

    endTimer = setTimeout(() => {
      stop('timer')
    }, clamped)

    void params.captureControl.setFrameCaptureSuppressed(true).catch((error) => {
      log.error('[Observation] setFrameCaptureSuppressed(true) failed:', error)
    })

    log.info(`[Observation] Started (durationMs=${clamped})`)
    emit()
    return getState()
  }

  const dispose = (): void => {
    if (endTimer) {
      clearTimeout(endTimer)
      endTimer = null
    }
    if (unsubscribe) {
      try {
        unsubscribe()
      } catch (error) {
        log.error('[Observation] app-watcher unsubscribe threw during dispose:', error)
      }
      unsubscribe = null
    }
    phase = 'idle'
    endsAt = null
  }

  return {
    start,
    stop,
    getState,
    dispose,
  }
}
