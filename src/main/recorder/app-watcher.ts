import { startAppWatcherMac, stopAppWatcherMac, isAppWatcherRunningMac } from './app-watcher-mac'
import { startAppWatcherWin, stopAppWatcherWin, isAppWatcherRunningWin } from './app-watcher-win'
import log from '../logger'

export interface AppWatcherEvent {
  type: 'app_change' | 'window_change' | 'ready' | 'error'
  timestamp: number
  app?: string
  hwnd?: string
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

type Listener = (event: AppWatcherEvent) => void

interface AppWatcherBackend {
  start(callback: Listener): void
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

const listeners = new Set<Listener>()
let backendStarted = false

function dispatch(event: AppWatcherEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (error) {
      log.warn(`[AppWatcher] Listener threw:`, error)
    }
  }
}

function ensureBackendStarted(): boolean {
  if (backendStarted) return true
  const backend = PLATFORM_APP_WATCHER_BACKENDS[process.platform]
  if (!backend) {
    log.warn(`[AppWatcher] No backend available for platform "${process.platform}"`)
    return false
  }
  try {
    backend.start(dispatch)
  } catch (error) {
    log.error(`[AppWatcher] Backend start threw for "${process.platform}":`, error)
    throw error
  }
  backendStarted = true
  return true
}

function maybeStopBackend(): void {
  if (!backendStarted) return
  if (listeners.size > 0) return
  const backend = PLATFORM_APP_WATCHER_BACKENDS[process.platform]
  backend?.stop()
  backendStarted = false
}

export function addAppWatcherListener(listener: Listener): () => void {
  // Start the backend first. If it throws, the listener is never added — so a
  // leaked entry can't block a future clean restart.
  ensureBackendStarted()
  listeners.add(listener)
  return () => {
    if (!listeners.delete(listener)) return
    maybeStopBackend()
  }
}

export function isAppWatcherRunning(): boolean {
  const backend = PLATFORM_APP_WATCHER_BACKENDS[process.platform]
  return backend?.isRunning() ?? false
}
