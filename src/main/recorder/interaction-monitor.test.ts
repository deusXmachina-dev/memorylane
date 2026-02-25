import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppWatcherEvent } from './app-watcher'

const mockUIOhook = {
  on: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  removeAllListeners: vi.fn(),
}

const mockScreen = {
  getDisplayNearestPoint: vi.fn().mockReturnValue({ id: 1 }),
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

let appWatcherCallback: ((event: AppWatcherEvent) => void) | null = null
const startAppWatcher = vi.fn((callback: (event: AppWatcherEvent) => void) => {
  appWatcherCallback = callback
})
const stopAppWatcher = vi.fn()

vi.mock('uiohook-napi', () => ({
  uIOhook: mockUIOhook,
}))

vi.mock('electron', () => ({
  screen: mockScreen,
}))

vi.mock('./app-watcher', () => ({
  startAppWatcher,
  stopAppWatcher,
}))

vi.mock('./app-watcher-display', () => ({
  resolveAppWatcherDisplay: vi.fn().mockReturnValue({ displayId: 1, source: 'event_display_id' }),
}))

vi.mock('../logger', () => ({
  default: mockLogger,
}))

describe('interaction-monitor app-watcher filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appWatcherCallback = null
  })

  afterEach(async () => {
    const mod = await import('./interaction-monitor')
    mod.stopInteractionMonitoring()
  })

  it('filters Explorer app-watcher events regardless of case', async () => {
    const mod = await import('./interaction-monitor')
    const callback = vi.fn()

    mod.onInteraction(callback)
    mod.startInteractionMonitoring()

    expect(appWatcherCallback).not.toBeNull()

    appWatcherCallback?.({
      type: 'app_change',
      timestamp: 1,
      app: 'explorer',
      title: 'File Explorer',
    })
    appWatcherCallback?.({
      type: 'app_change',
      timestamp: 2,
      app: 'Explorer',
      title: 'Downloads',
    })
    appWatcherCallback?.({
      type: 'window_change',
      timestamp: 3,
      app: 'EXPLORER',
      title: 'Desktop',
    })
    appWatcherCallback?.({
      type: 'window_change',
      timestamp: 4,
      app: 'Explorer.exe',
      title: 'This PC',
    })

    expect(callback).not.toHaveBeenCalled()
    mod.clearInteractionCallback(callback)
  })
})
