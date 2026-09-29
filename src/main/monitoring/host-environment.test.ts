import type { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AWAKE_CHECK_DELAYS_MS,
  HostEnvironment,
  ManualHostEnvironment,
  remoteHost,
} from './host-environment'
import { HOST_RESOLVE_TIMEOUT_MS } from '@/shared/constants'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  const powerMonitor = Object.assign(new EventEmitter(), {
    isOnBatteryPower: () => false,
    getSystemIdleTime: () => 0,
  })
  return { powerMonitor, net: { isOnline: () => true } }
})
vi.mock('@main/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const fetchFailed = (): TypeError =>
  new TypeError('fetch failed', {
    cause: Object.assign(new Error('getaddrinfo ENOTFOUND backend.test'), { code: 'ENOTFOUND' }),
  })

describe('power events', () => {
  const started = async (onPauseChange = vi.fn()) => {
    const emitter = (await import('electron')).powerMonitor as unknown as EventEmitter
    emitter.removeAllListeners()
    const host = new HostEnvironment()
    host.start(onPauseChange)
    return { host, emitter, onPauseChange }
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts awake with no suspend recorded', async () => {
    const { host } = await started()
    expect(host.isSuspended()).toBe(false)
    expect(host.lastSuspendAt()).toBe(0)
    expect(host.shouldPause()).toBe(false)
  })

  it('suspend sets the flag, records when it happened and pauses', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-10T07:03:30Z'))
    const { host, emitter, onPauseChange } = await started()
    emitter.emit('suspend')
    expect(host.isSuspended()).toBe(true)
    expect(host.lastSuspendAt()).toBe(Date.parse('2026-09-10T07:03:30Z'))
    expect(onPauseChange).toHaveBeenLastCalledWith(true)
  })

  it('resume clears the flag but keeps the suspend time', async () => {
    const { host, emitter, onPauseChange } = await started()
    emitter.emit('suspend')
    const at = host.lastSuspendAt()
    emitter.emit('resume')
    expect(host.isSuspended()).toBe(false)
    expect(host.lastSuspendAt()).toBe(at)
    expect(onPauseChange).toHaveBeenLastCalledWith(false)
  })

  it('a locked screen pauses until unlocked', async () => {
    const { host, emitter, onPauseChange } = await started()
    emitter.emit('lock-screen')
    expect(host.shouldPause()).toBe(true)
    expect(onPauseChange).toHaveBeenLastCalledWith(true)
    emitter.emit('unlock-screen')
    expect(host.shouldPause()).toBe(false)
    expect(onPauseChange).toHaveBeenLastCalledWith(false)
  })

  it('onSuspend and onResume listeners fire until unsubscribed', async () => {
    const { host, emitter } = await started()
    const onSuspend = vi.fn()
    const onResume = vi.fn()
    const offSuspend = host.onSuspend(onSuspend)
    const offResume = host.onResume(onResume)

    emitter.emit('suspend')
    expect(onSuspend).toHaveBeenCalledTimes(1)
    expect(onResume).not.toHaveBeenCalled()
    emitter.emit('resume')
    expect(onResume).toHaveBeenCalledTimes(1)

    offSuspend()
    offResume()
    emitter.emit('suspend')
    emitter.emit('resume')
    expect(onSuspend).toHaveBeenCalledTimes(1)
    expect(onResume).toHaveBeenCalledTimes(1)
  })
})

describe('standDownReason', () => {
  it('is null on an awake, online host', () => {
    expect(new ManualHostEnvironment().standDownReason('https://backend.test/')).toBeNull()
  })

  it('reports suspended ahead of offline', () => {
    const host = new ManualHostEnvironment()
    host.suspend()
    host.online = false
    expect(host.standDownReason('https://backend.test/')).toBe('suspended')
  })

  it('reports offline for a remote target', () => {
    const host = new ManualHostEnvironment()
    host.online = false
    expect(host.standDownReason('https://backend.test/')).toBe('offline')
    expect(host.standDownReason(undefined)).toBe('offline')
  })

  it('lets a loopback target through while offline', () => {
    const host = new ManualHostEnvironment()
    host.online = false
    expect(host.standDownReason('http://localhost:11434/v1')).toBeNull()
  })
})

describe('remoteHost', () => {
  it('returns the hostname of a remote URL', () => {
    expect(remoteHost('https://backend.test/api/')).toBe('backend.test')
  })

  it('is null for loopback, IP literals, and unparsable input', () => {
    expect(remoteHost(undefined)).toBeNull()
    expect(remoteHost('http://localhost:11434/v1')).toBeNull()
    expect(remoteHost('http://192.168.1.10:11434/v1')).toBeNull()
    expect(remoteHost('http://[fd12::10]:11434/v1')).toBeNull()
    expect(remoteHost('not a url')).toBeNull()
  })
})

describe('standDown', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is null when awake, online and the target resolves', async () => {
    const host = new ManualHostEnvironment()
    const lookup = vi.spyOn(host, 'resolves')
    expect(await host.standDown('https://backend.test/')).toBeNull()
    expect(lookup).toHaveBeenCalledWith('backend.test')
  })

  it('reports unresolved when the target does not resolve', async () => {
    const host = new ManualHostEnvironment()
    host.resolvable = false
    expect(await host.standDown('https://backend.test/')).toBe('unresolved')
  })

  it('reports suspended and offline without a lookup', async () => {
    const host = new ManualHostEnvironment()
    const lookup = vi.spyOn(host, 'resolves')
    host.online = false
    expect(await host.standDown('https://backend.test/')).toBe('offline')
    host.suspend()
    expect(await host.standDown('https://backend.test/')).toBe('suspended')
    expect(lookup).not.toHaveBeenCalled()
  })

  it('skips the lookup for loopback and IP-literal targets', async () => {
    const host = new ManualHostEnvironment()
    host.resolvable = false
    expect(await host.standDown('http://localhost:8000/')).toBeNull()
    expect(await host.standDown('http://10.0.0.5:8000/')).toBeNull()
  })

  it('treats a hung lookup as unresolved', async () => {
    vi.useFakeTimers()
    const host = new ManualHostEnvironment()
    vi.spyOn(host, 'resolves').mockReturnValue(new Promise<boolean>(() => {}))
    const pending = host.standDown('https://backend.test/')
    await vi.advanceTimersByTimeAsync(HOST_RESOLVE_TIMEOUT_MS)
    expect(await pending).toBe('unresolved')
  })
})

describe('interruptedBy', () => {
  const sleptAt = (at: number): ManualHostEnvironment => {
    const host = new ManualHostEnvironment()
    host.suspend(at)
    host.resume()
    return host
  }

  it('is false for a non-network error even across a suspend', () => {
    expect(
      sleptAt(2_000).interruptedBy(1_000, 'https://backend.test/', new Error('HTTP 500')),
    ).toBe(false)
  })

  it('is false for a network error with no suspend and the host online', () => {
    expect(
      new ManualHostEnvironment().interruptedBy(1_000, 'https://backend.test/', fetchFailed()),
    ).toBe(false)
  })

  it('is true for a network error after a suspend that followed the start', () => {
    expect(sleptAt(2_000).interruptedBy(1_000, 'https://backend.test/', fetchFailed())).toBe(true)
  })

  it('ignores a suspend that predates the start', () => {
    expect(sleptAt(500).interruptedBy(1_000, 'https://backend.test/', fetchFailed())).toBe(false)
  })

  it('is true for a network error while the host reports offline', () => {
    const host = new ManualHostEnvironment()
    host.online = false
    expect(host.interruptedBy(1_000, 'https://backend.test/', fetchFailed())).toBe(true)
  })

  it('treats an abort as a network error', () => {
    const host = new ManualHostEnvironment()
    host.suspend()
    const abort = new DOMException('System suspended', 'AbortError')
    expect(host.interruptedBy(1_000, 'https://backend.test/', abort)).toBe(true)
  })
})

describe('suspendSignal', () => {
  it('aborts when the host suspends and stops listening once released', () => {
    const host = new ManualHostEnvironment()
    const { signal, release } = host.suspendSignal()
    expect(signal.aborted).toBe(false)
    expect(host.suspendListenerCount).toBe(1)

    host.suspend()
    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBeInstanceOf(DOMException)
    expect((signal.reason as DOMException).name).toBe('AbortError')

    release()
    expect(host.suspendListenerCount).toBe(0)
  })
})

describe('onAwake', () => {
  const [first, second, third] = AWAKE_CHECK_DELAYS_MS

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires once the host is online after a resume, not on the resume itself', () => {
    vi.useFakeTimers()
    const host = new ManualHostEnvironment()
    const listener = vi.fn()
    host.onAwake(listener)

    host.suspend()
    host.resume()
    expect(listener).not.toHaveBeenCalled()

    vi.advanceTimersByTime(first)
    expect(listener).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(second + third)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps checking while offline and fires when the network comes back', () => {
    vi.useFakeTimers()
    const host = new ManualHostEnvironment()
    host.online = false
    const listener = vi.fn()
    host.onAwake(listener)

    host.suspend()
    host.resume()
    vi.advanceTimersByTime(first)
    expect(listener).not.toHaveBeenCalled()

    host.online = true
    vi.advanceTimersByTime(second)
    expect(listener).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(third)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('fires after the last check even if still offline', () => {
    vi.useFakeTimers()
    const host = new ManualHostEnvironment()
    host.online = false
    const listener = vi.fn()
    host.onAwake(listener)

    host.suspend()
    host.resume()
    vi.advanceTimersByTime(first + second)
    expect(listener).not.toHaveBeenCalled()
    vi.advanceTimersByTime(third)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('drops the pending kick when the host suspends again', () => {
    vi.useFakeTimers()
    const host = new ManualHostEnvironment()
    const listener = vi.fn()
    host.onAwake(listener)

    host.suspend()
    host.resume()
    vi.advanceTimersByTime(first / 2)
    host.suspend()
    vi.advanceTimersByTime(first + second + third)
    expect(listener).not.toHaveBeenCalled()

    host.resume()
    vi.advanceTimersByTime(first)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('a second resume restarts the wait', () => {
    vi.useFakeTimers()
    const host = new ManualHostEnvironment()
    const listener = vi.fn()
    host.onAwake(listener)

    host.suspend()
    host.resume()
    vi.advanceTimersByTime(first / 2)
    host.resume()
    vi.advanceTimersByTime(first / 2)
    expect(listener).not.toHaveBeenCalled()
    vi.advanceTimersByTime(first / 2)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('unsubscribing cancels a pending kick', () => {
    vi.useFakeTimers()
    const host = new ManualHostEnvironment()
    const listener = vi.fn()
    const unsubscribe = host.onAwake(listener)

    host.suspend()
    host.resume()
    unsubscribe()
    vi.advanceTimersByTime(first + second + third)
    expect(listener).not.toHaveBeenCalled()
    expect(host.resumeListenerCount).toBe(0)
  })
})
