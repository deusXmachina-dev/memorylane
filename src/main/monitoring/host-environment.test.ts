import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_HOST_ENVIRONMENT,
  interruptedByHost,
  standDownReason,
  suspendSignal,
  type HostEnvironment,
} from './host-environment'

const envWith = (overrides: Partial<HostEnvironment>): HostEnvironment => ({
  ...DEFAULT_HOST_ENVIRONMENT,
  ...overrides,
})

const fetchFailed = (): TypeError =>
  new TypeError('fetch failed', {
    cause: Object.assign(new Error('getaddrinfo ENOTFOUND backend.test'), { code: 'ENOTFOUND' }),
  })

describe('standDownReason', () => {
  it('is null on an awake, online host', () => {
    expect(standDownReason(DEFAULT_HOST_ENVIRONMENT, 'https://backend.test/')).toBeNull()
  })

  it('reports suspended ahead of offline', () => {
    const env = envWith({ isSuspended: () => true, isOnline: () => false })
    expect(standDownReason(env, 'https://backend.test/')).toBe('suspended')
  })

  it('reports offline for a remote target', () => {
    const env = envWith({ isOnline: () => false })
    expect(standDownReason(env, 'https://backend.test/')).toBe('offline')
    expect(standDownReason(env, undefined)).toBe('offline')
  })

  it('lets a loopback target through while offline', () => {
    const env = envWith({ isOnline: () => false })
    expect(standDownReason(env, 'http://localhost:11434/v1')).toBeNull()
  })
})

describe('interruptedByHost', () => {
  it('is false for a non-network error even across a suspend', () => {
    const env = envWith({ lastSuspendAt: () => 2_000 })
    expect(interruptedByHost(env, 1_000, 'https://backend.test/', new Error('HTTP 500'))).toBe(
      false,
    )
  })

  it('is false for a network error with no suspend and the host online', () => {
    expect(
      interruptedByHost(DEFAULT_HOST_ENVIRONMENT, 1_000, 'https://backend.test/', fetchFailed()),
    ).toBe(false)
  })

  it('is true for a network error after a suspend that followed the start', () => {
    const env = envWith({ lastSuspendAt: () => 2_000 })
    expect(interruptedByHost(env, 1_000, 'https://backend.test/', fetchFailed())).toBe(true)
  })

  it('ignores a suspend that predates the start', () => {
    const env = envWith({ lastSuspendAt: () => 500 })
    expect(interruptedByHost(env, 1_000, 'https://backend.test/', fetchFailed())).toBe(false)
  })

  it('is true for a network error while the host reports offline', () => {
    const env = envWith({ isOnline: () => false })
    expect(interruptedByHost(env, 1_000, 'https://backend.test/', fetchFailed())).toBe(true)
  })

  it('treats an abort as a network error', () => {
    const env = envWith({ isSuspended: () => true })
    const abort = new DOMException('System suspended', 'AbortError')
    expect(interruptedByHost(env, 1_000, 'https://backend.test/', abort)).toBe(true)
  })
})

describe('suspendSignal', () => {
  it('aborts when the host suspends and stops listening once released', () => {
    const listeners = new Set<() => void>()
    const unsubscribe = vi.fn(() => undefined)
    const env = envWith({
      onSuspend: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
          unsubscribe()
        }
      },
    })

    const { signal, release } = suspendSignal(env)
    expect(signal.aborted).toBe(false)

    for (const listener of listeners) listener()
    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBeInstanceOf(DOMException)
    expect((signal.reason as DOMException).name).toBe('AbortError')

    release()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(listeners.size).toBe(0)
  })
})
