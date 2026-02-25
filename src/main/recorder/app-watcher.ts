import { startAppWatcherMac, stopAppWatcherMac, isAppWatcherRunningMac } from './app-watcher-mac'
import { startAppWatcherWin, stopAppWatcherWin, isAppWatcherRunningWin } from './app-watcher-win'
import log from '../logger'

export interface AppWatcherEvent {
  type: 'app_change' | 'window_change' | 'ready' | 'error'
  timestamp: number
  app?: string
  bundleId?: string
  pid?: number
  title?: string
  url?: string
  displayId?: number
  windowBounds?: {
    x: number
    y: number
    width: number
    height: number
  }
  error?: string
}

interface AppWatcherBackend {
  start(callback: (event: AppWatcherEvent) => void): void
  stop(): void
  isRunning(): boolean
}

const PLATFORM_APP_WATCHER_BACKENDS: Partial<Record<NodeJS.Platform, AppWatcherBackend>> = {
  darwin: {
    start: startAppWatcherMac,
    stop: stopAppWatcherMac,
    isRunning: isAppWatcherRunningMac,
  },
  win32: {
    start: startAppWatcherWin,
    stop: stopAppWatcherWin,
    isRunning: isAppWatcherRunningWin,
  },
}

export function startAppWatcher(callback: (event: AppWatcherEvent) => void): void {
  const backend = PLATFORM_APP_WATCHER_BACKENDS[process.platform]
  if (!backend) {
    log.warn(`[AppWatcher] No backend available for platform "${process.platform}"`)
    return
  }
  backend.start(callback)
}

export function stopAppWatcher(): void {
  const backend = PLATFORM_APP_WATCHER_BACKENDS[process.platform]
  backend?.stop()
}

export function isAppWatcherRunning(): boolean {
  const backend = PLATFORM_APP_WATCHER_BACKENDS[process.platform]
  return backend?.isRunning() ?? false
}
