import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_PLATFORM = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  })
}

describe('app-watcher backend selection', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM)
    vi.restoreAllMocks()
  })

  it('routes win32 to the Windows backend', async () => {
    setPlatform('win32')
    const startMac = vi.fn()
    const stopMac = vi.fn()
    const isRunningMac = vi.fn().mockReturnValue(false)
    const startWin = vi.fn()
    const stopWin = vi.fn()
    const isRunningWin = vi.fn().mockReturnValue(true)

    vi.doMock('./app-watcher-mac', () => ({
      startAppWatcherMac: startMac,
      stopAppWatcherMac: stopMac,
      isAppWatcherRunningMac: isRunningMac,
    }))
    vi.doMock('./app-watcher-win', () => ({
      startAppWatcherWin: startWin,
      stopAppWatcherWin: stopWin,
      isAppWatcherRunningWin: isRunningWin,
    }))
    vi.doMock('../logger', () => ({
      default: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    }))

    const { startAppWatcher, stopAppWatcher, isAppWatcherRunning } = await import('./app-watcher')
    const callback = vi.fn()

    startAppWatcher(callback)
    expect(startWin).toHaveBeenCalledWith(callback)
    expect(startMac).not.toHaveBeenCalled()

    stopAppWatcher()
    expect(stopWin).toHaveBeenCalledTimes(1)
    expect(stopMac).not.toHaveBeenCalled()

    expect(isAppWatcherRunning()).toBe(true)
    expect(isRunningWin).toHaveBeenCalledTimes(1)
    expect(isRunningMac).not.toHaveBeenCalled()
  })

  it('warns and no-ops on unsupported platforms', async () => {
    setPlatform('linux')
    const warn = vi.fn()

    vi.doMock('./app-watcher-mac', () => ({
      startAppWatcherMac: vi.fn(),
      stopAppWatcherMac: vi.fn(),
      isAppWatcherRunningMac: vi.fn().mockReturnValue(false),
    }))
    vi.doMock('./app-watcher-win', () => ({
      startAppWatcherWin: vi.fn(),
      stopAppWatcherWin: vi.fn(),
      isAppWatcherRunningWin: vi.fn().mockReturnValue(false),
    }))
    vi.doMock('../logger', () => ({
      default: { warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    }))

    const { startAppWatcher, stopAppWatcher, isAppWatcherRunning } = await import('./app-watcher')
    startAppWatcher(vi.fn())
    stopAppWatcher()

    expect(warn).toHaveBeenCalledWith('[AppWatcher] No backend available for platform "linux"')
    expect(isAppWatcherRunning()).toBe(false)
  })
})
