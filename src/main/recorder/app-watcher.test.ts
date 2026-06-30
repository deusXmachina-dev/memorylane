import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_PLATFORM = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  })
}

function mockLogger(): void {
  vi.doMock('@main/utils/logger', () => ({
    default: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
  }))
}

describe('app-watcher backend selection and fan-out', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM)
    vi.restoreAllMocks()
  })

  it('routes win32 to the Windows backend on first listener and stops on last unsubscribe', async () => {
    setPlatform('win32')
    const startMac = vi.fn()
    const stopMac = vi.fn()
    const startWin = vi.fn()
    const stopWin = vi.fn()

    vi.doMock('./app-watcher-mac', () => ({
      startAppWatcherMac: startMac,
      stopAppWatcherMac: stopMac,
      isAppWatcherRunningMac: vi.fn().mockReturnValue(false),
    }))
    vi.doMock('./app-watcher-win', () => ({
      startAppWatcherWin: startWin,
      stopAppWatcherWin: stopWin,
      isAppWatcherRunningWin: vi.fn().mockReturnValue(true),
    }))
    mockLogger()

    const { addAppWatcherListener } = await import('./app-watcher')
    const listener = vi.fn()

    const unsubscribe = addAppWatcherListener(listener)
    expect(startWin).toHaveBeenCalledTimes(1)
    expect(startMac).not.toHaveBeenCalled()

    unsubscribe()
    expect(stopWin).toHaveBeenCalledTimes(1)
    expect(stopMac).not.toHaveBeenCalled()
  })

  it('fans out a single backend emission to every registered listener', async () => {
    setPlatform('darwin')
    let capturedDispatch: ((event: unknown) => void) | null = null
    vi.doMock('./app-watcher-mac', () => ({
      startAppWatcherMac: (cb: (event: unknown) => void) => {
        capturedDispatch = cb
      },
      stopAppWatcherMac: vi.fn(),
      isAppWatcherRunningMac: vi.fn().mockReturnValue(true),
    }))
    vi.doMock('./app-watcher-win', () => ({
      startAppWatcherWin: vi.fn(),
      stopAppWatcherWin: vi.fn(),
      isAppWatcherRunningWin: vi.fn().mockReturnValue(false),
    }))
    mockLogger()

    const { addAppWatcherListener } = await import('./app-watcher')
    const a = vi.fn()
    const b = vi.fn()

    const unsubA = addAppWatcherListener(a)
    addAppWatcherListener(b)

    expect(capturedDispatch).toBeTypeOf('function')
    const event = { type: 'app_change', timestamp: 1, app: 'TestApp' }
    capturedDispatch!(event)

    expect(a).toHaveBeenCalledWith(event)
    expect(b).toHaveBeenCalledWith(event)

    unsubA()
    const event2 = { type: 'window_change', timestamp: 2, app: 'Other' }
    capturedDispatch!(event2)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledWith(event2)
  })

  it('only stops the backend after the last listener is removed', async () => {
    setPlatform('darwin')
    const startMac = vi.fn()
    const stopMac = vi.fn()
    vi.doMock('./app-watcher-mac', () => ({
      startAppWatcherMac: startMac,
      stopAppWatcherMac: stopMac,
      isAppWatcherRunningMac: vi.fn().mockReturnValue(true),
    }))
    vi.doMock('./app-watcher-win', () => ({
      startAppWatcherWin: vi.fn(),
      stopAppWatcherWin: vi.fn(),
      isAppWatcherRunningWin: vi.fn().mockReturnValue(false),
    }))
    mockLogger()

    const { addAppWatcherListener } = await import('./app-watcher')
    const unsubA = addAppWatcherListener(vi.fn())
    const unsubB = addAppWatcherListener(vi.fn())

    expect(startMac).toHaveBeenCalledTimes(1)

    unsubA()
    expect(stopMac).not.toHaveBeenCalled()

    unsubB()
    expect(stopMac).toHaveBeenCalledTimes(1)
  })

  it('keeps backend alive across interleaved subscribers (interaction-monitor + observation)', async () => {
    setPlatform('darwin')
    const startMac = vi.fn()
    const stopMac = vi.fn()
    let capturedDispatch: ((event: unknown) => void) | null = null
    vi.doMock('./app-watcher-mac', () => ({
      startAppWatcherMac: (cb: (event: unknown) => void) => {
        capturedDispatch = cb
        startMac()
      },
      stopAppWatcherMac: stopMac,
      isAppWatcherRunningMac: vi.fn().mockReturnValue(true),
    }))
    vi.doMock('./app-watcher-win', () => ({
      startAppWatcherWin: vi.fn(),
      stopAppWatcherWin: vi.fn(),
      isAppWatcherRunningWin: vi.fn().mockReturnValue(false),
    }))
    mockLogger()

    const { addAppWatcherListener } = await import('./app-watcher')

    // 1. interaction-monitor subscribes first — backend boots.
    const interactionListener = vi.fn()
    const unsubInteraction = addAppWatcherListener(interactionListener)
    expect(startMac).toHaveBeenCalledTimes(1)
    expect(stopMac).not.toHaveBeenCalled()

    // 2. observation subscribes on top — no second backend boot.
    const observationListener = vi.fn()
    const unsubObservation = addAppWatcherListener(observationListener)
    expect(startMac).toHaveBeenCalledTimes(1)

    // Both listeners receive a native event.
    const event1 = { type: 'app_change', timestamp: 1, app: 'Slack' }
    capturedDispatch!(event1)
    expect(interactionListener).toHaveBeenCalledWith(event1)
    expect(observationListener).toHaveBeenCalledWith(event1)

    // 3. interaction-monitor unsubscribes (e.g. user stops capture).
    //    Backend MUST stay running because observation still needs it.
    unsubInteraction()
    expect(stopMac).not.toHaveBeenCalled()

    // Observation still receives events; interaction listener does not.
    const event2 = { type: 'window_change', timestamp: 2, url: 'https://bank.example.com' }
    capturedDispatch!(event2)
    expect(interactionListener).toHaveBeenCalledTimes(1)
    expect(observationListener).toHaveBeenCalledWith(event2)

    // 4. observation unsubscribes — backend stops now.
    unsubObservation()
    expect(stopMac).toHaveBeenCalledTimes(1)
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
    vi.doMock('@main/utils/logger', () => ({
      default: { warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() },
    }))

    const { addAppWatcherListener, isAppWatcherRunning } = await import('./app-watcher')
    addAppWatcherListener(vi.fn())

    expect(warn).toHaveBeenCalledWith('[AppWatcher] No backend available for platform "linux"')
    expect(isAppWatcherRunning()).toBe(false)
  })
})
