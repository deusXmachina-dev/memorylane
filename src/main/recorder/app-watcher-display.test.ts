import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_PLATFORM = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  })
}

const mockScreen = {
  screenToDipRect: vi.fn(),
  getDisplayMatching: vi.fn(),
  getCursorScreenPoint: vi.fn(),
  getDisplayNearestPoint: vi.fn(),
}

vi.mock('electron', () => ({
  screen: mockScreen,
}))

describe('resolveAppWatcherDisplay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockScreen.screenToDipRect.mockImplementation((_window, rect) => rect)
    mockScreen.getDisplayMatching.mockReturnValue({ id: 4 })
    mockScreen.getCursorScreenPoint.mockReturnValue({ x: 10, y: 20 })
    mockScreen.getDisplayNearestPoint.mockReturnValue({ id: 9 })
  })

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM)
  })

  it('prefers event displayId when present', async () => {
    const { resolveAppWatcherDisplay } = await import('./app-watcher-display')
    const resolved = resolveAppWatcherDisplay({
      type: 'app_change',
      timestamp: 100,
      displayId: 7,
    })

    expect(resolved).toEqual({ displayId: 7, source: 'event_display_id' })
    expect(mockScreen.getDisplayMatching).not.toHaveBeenCalled()
    expect(mockScreen.getDisplayNearestPoint).not.toHaveBeenCalled()
  })

  it('resolves display from windowBounds before cursor fallback on Windows', async () => {
    setPlatform('win32')
    mockScreen.screenToDipRect.mockReturnValue({ x: 1, y: 2, width: 3, height: 4 })
    mockScreen.getDisplayMatching.mockReturnValue({ id: 12 })

    const { resolveAppWatcherDisplay } = await import('./app-watcher-display')
    const resolved = resolveAppWatcherDisplay({
      type: 'window_change',
      timestamp: 100,
      windowBounds: { x: 100, y: 200, width: 800, height: 600 },
    })

    expect(mockScreen.screenToDipRect).toHaveBeenCalledWith(null, {
      x: 100,
      y: 200,
      width: 800,
      height: 600,
    })
    expect(mockScreen.getDisplayMatching).toHaveBeenCalledWith({ x: 1, y: 2, width: 3, height: 4 })
    expect(resolved).toEqual({ displayId: 12, source: 'window_bounds' })
  })

  it('falls back to cursor when windowBounds resolution fails', async () => {
    setPlatform('win32')
    mockScreen.screenToDipRect.mockImplementation(() => {
      throw new Error('conversion failed')
    })

    const { resolveAppWatcherDisplay } = await import('./app-watcher-display')
    const resolved = resolveAppWatcherDisplay({
      type: 'app_change',
      timestamp: 100,
      windowBounds: { x: 1, y: 2, width: 400, height: 300 },
    })

    expect(mockScreen.getCursorScreenPoint).toHaveBeenCalledTimes(1)
    expect(mockScreen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: 10, y: 20 })
    expect(resolved).toEqual({ displayId: 9, source: 'cursor_fallback' })
  })
})
