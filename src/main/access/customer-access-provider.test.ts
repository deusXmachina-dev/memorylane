import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(async () => undefined),
  },
}))

vi.mock('../logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { CustomerAccessProvider } from './customer-access-provider'
import { MANAGED_KEY_CONFIG } from '../../shared/constants'
import type { DeviceIdentity } from '../settings/device-identity'

describe('CustomerAccessProvider', () => {
  const originalFetch = globalThis.fetch
  const deviceIdentity = {
    getDeviceId: () => 'device-123',
  } as unknown as DeviceIdentity

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
  })

  it('publishes managed key after checkout polling succeeds', async () => {
    const responses = [
      { ok: true, json: async () => ({ key: null }) } as unknown as Response,
      { ok: true, json: async () => ({ key: 'sk-or-customer' }) } as unknown as Response,
    ]
    globalThis.fetch = vi.fn(async () => responses.shift() as Response) as typeof fetch

    const provider = new CustomerAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null; payload?: unknown }> = []
    provider.setUpdateCallback((state, payload) => {
      updates.push({ status: state.customerSubscriptionStatus, payload })
    })

    await provider.startCheckout('explorer')
    await vi.advanceTimersByTimeAsync(MANAGED_KEY_CONFIG.POLL_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(MANAGED_KEY_CONFIG.POLL_INTERVAL_MS)

    expect(updates[0]?.status).toBe('awaiting_checkout')
    expect(updates[1]?.status).toBe('polling')
    expect(updates.at(-1)?.status).toBe('idle')
    expect(updates.at(-1)?.payload).toEqual({ key: 'sk-or-customer' })
  })
})
