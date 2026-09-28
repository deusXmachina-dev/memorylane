import { afterEach, describe, expect, it, vi } from 'vitest'
import { AWAKE_CHECK_DELAYS_MS, ManualHostEnvironment } from './host-environment'

const fetchFailed = (): TypeError =>
  new TypeError('fetch failed', {
    cause: Object.assign(new Error('getaddrinfo ENOTFOUND backend.test'), { code: 'ENOTFOUND' }),
  })

describe('standDownReason', () => {
  it('is null on an awake, online host', () => {
    expect(new ManualHostEnvironment().standDownReason('https://backend.test/')).toBeNull()
  })

  it('reports suspended ahead of offline', () => {
    const host = new ManualHostEnvironment()
    host.suspended = true
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

describe('interruptedBy', () => {
  it('is false for a non-network error even across a suspend', () => {
    const host = new ManualHostEnvironment()
    host.suspendedAt = 2_000
    expect(host.interruptedBy(1_000, 'https://backend.test/', new Error('HTTP 500'))).toBe(false)
  })

  it('is false for a network error with no suspend and the host online', () => {
    expect(
      new ManualHostEnvironment().interruptedBy(1_000, 'https://backend.test/', fetchFailed()),
    ).toBe(false)
  })

  it('is true for a network error after a suspend that followed the start', () => {
    const host = new ManualHostEnvironment()
    host.suspendedAt = 2_000
    expect(host.interruptedBy(1_000, 'https://backend.test/', fetchFailed())).toBe(true)
  })

  it('ignores a suspend that predates the start', () => {
    const host = new ManualHostEnvironment()
    host.suspendedAt = 500
    expect(host.interruptedBy(1_000, 'https://backend.test/', fetchFailed())).toBe(false)
  })

  it('is true for a network error while the host reports offline', () => {
    const host = new ManualHostEnvironment()
    host.online = false
    expect(host.interruptedBy(1_000, 'https://backend.test/', fetchFailed())).toBe(true)
  })

  it('treats an abort as a network error', () => {
    const host = new ManualHostEnvironment()
    host.suspended = true
    const abort = new DOMException('System suspended', 'AbortError')
    expect(host.interruptedBy(1_000, 'https://backend.test/', abort)).toBe(true)
  })
})

describe('suspendSignal', () => {
  it('aborts when the host suspends and stops listening once released', () => {
    const host = new ManualHostEnvironment()
    const { signal, release } = host.suspendSignal()
    expect(signal.aborted).toBe(false)
    expect(host.suspendListeners.size).toBe(1)

    host.suspend()
    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBeInstanceOf(DOMException)
    expect((signal.reason as DOMException).name).toBe('AbortError')

    release()
    expect(host.suspendListeners.size).toBe(0)
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
    expect(host.resumeListeners.size).toBe(0)
  })
})
