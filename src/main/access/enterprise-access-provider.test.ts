import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { EnterpriseAccessProvider } from './enterprise-access-provider'
import { ENTERPRISE_BACKEND_CONFIG } from '../../shared/constants'
import type { DeviceIdentity } from '../settings/device-identity'

describe('EnterpriseAccessProvider', () => {
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

  it('publishes activation completion after status and key polling succeed', async () => {
    const responses = [
      { ok: true, json: async () => ({ ok: true, consent: null }) } as unknown as Response,
      { ok: true, json: async () => ({ activated: false }) } as unknown as Response,
      { ok: true, json: async () => ({ activated: true }) } as unknown as Response,
      { ok: true, json: async () => ({ key: 'sk-or-enterprise' }) } as unknown as Response,
    ]
    globalThis.fetch = vi.fn(async () => responses.shift() as Response) as typeof fetch

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null; payload?: unknown }> = []
    provider.setUpdateCallback((state, payload) => {
      updates.push({ status: state.enterpriseActivationStatus, payload })
    })

    await provider.activateEnterpriseLicense('ACT-123')
    await vi.advanceTimersByTimeAsync(ENTERPRISE_BACKEND_CONFIG.POLL_INTERVAL_MS)

    expect(updates[0]?.status).toBe('activating')
    expect(updates.at(-1)?.status).toBe('activated')
    expect(updates.at(-1)?.payload).toEqual({ key: 'sk-or-enterprise' })
  })

  it('parks in awaiting_consent when probe returns a consent payload', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: false,
        consent: {
          url: '/api/license/consent-document/abc',
          version: 3,
          sha256: 'abc',
          title: 'Employee data consent',
          content_type: 'application/pdf',
        },
      }),
    })) as unknown as typeof fetch

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null }> = []
    provider.setUpdateCallback((state) => {
      updates.push({ status: state.enterpriseActivationStatus })
    })

    await provider.activateEnterpriseLicense('ACT-123')

    expect(updates.at(-1)?.status).toBe('awaiting_consent')
  })

  it('resumes activation polling after consent is accepted', async () => {
    const responses = [
      {
        ok: true,
        json: async () => ({
          ok: false,
          consent: {
            url: '/api/license/consent-document/abc',
            version: 3,
            sha256: 'abc',
            title: 'Employee data consent',
            content_type: 'application/pdf',
          },
        }),
      } as unknown as Response,
      { ok: true, json: async () => ({ ok: true, declined: false }) } as unknown as Response,
      { ok: true, json: async () => ({ activated: true }) } as unknown as Response,
      { ok: true, json: async () => ({ key: 'sk-or-enterprise' }) } as unknown as Response,
    ]
    globalThis.fetch = vi.fn(async () => responses.shift() as Response) as typeof fetch

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null; payload?: unknown }> = []
    provider.setUpdateCallback((state, payload) => {
      updates.push({ status: state.enterpriseActivationStatus, payload })
    })

    await provider.activateEnterpriseLicense('ACT-123')
    expect(updates.at(-1)?.status).toBe('awaiting_consent')

    await provider.submitConsentDecision('accepted')
    await vi.advanceTimersByTimeAsync(ENTERPRISE_BACKEND_CONFIG.POLL_INTERVAL_MS)

    expect(updates.at(-1)?.status).toBe('activated')
    expect(updates.at(-1)?.payload).toEqual({ key: 'sk-or-enterprise' })
  })

  it('returns to inactive when consent is declined', async () => {
    const responses = [
      {
        ok: true,
        json: async () => ({
          ok: false,
          consent: {
            url: '/api/license/consent-document/abc',
            version: 3,
            sha256: 'abc',
            title: 'Employee data consent',
            content_type: 'application/pdf',
          },
        }),
      } as unknown as Response,
      { ok: true, json: async () => ({ ok: false, declined: true }) } as unknown as Response,
    ]
    globalThis.fetch = vi.fn(async () => responses.shift() as Response) as typeof fetch

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null }> = []
    provider.setUpdateCallback((state) => {
      updates.push({ status: state.enterpriseActivationStatus })
    })

    await provider.activateEnterpriseLicense('ACT-123')
    await provider.submitConsentDecision('declined')

    expect(updates.at(-1)?.status).toBe('inactive')
  })

  it('publishes invalidation on refresh when license status is inactive', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ activated: false }),
    })) as unknown as typeof fetch

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null; payload?: unknown }> = []
    provider.setUpdateCallback((state, payload) => {
      updates.push({ status: state.enterpriseActivationStatus, payload })
    })

    await provider.refreshAccessState()

    expect(updates).toHaveLength(1)
    expect(updates[0]?.status).toBe('inactive')
    expect(updates[0]?.payload).toEqual({ invalidate: true })
  })
})
