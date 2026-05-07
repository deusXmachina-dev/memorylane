import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { openExternalMock } = vi.hoisted(() => ({
  openExternalMock: vi.fn(async () => undefined),
}))

vi.mock('electron', () => ({
  shell: {
    openExternal: openExternalMock,
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

type FetchCall = [unknown, RequestInit | undefined]

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

function makeFetchMock(responses: Response[]): typeof fetch {
  const queue = [...responses]
  return vi.fn(async () => queue.shift() as Response) as unknown as typeof fetch
}

function findCall(fetchMock: typeof fetch, urlPart: string): FetchCall {
  const calls = (fetchMock as unknown as { mock: { calls: FetchCall[] } }).mock.calls
  const call = calls.find((c) => String(c[0]).includes(urlPart))
  if (!call) throw new Error(`No fetch call to ${urlPart}`)
  return call
}

// Signed URLs returned by the backend must share its registrable domain;
// build them off BACKEND_URL so tests stay in sync if the host changes.
const BACKEND_HOST = new URL(MANAGED_KEY_CONFIG.BACKEND_URL).hostname
const inBackendDomain = (suffix: string): string => `https://${BACKEND_HOST}${suffix}`

describe('CustomerAccessProvider', () => {
  const originalFetch = globalThis.fetch
  const deviceIdentity = {
    getDeviceId: () => 'device-123',
  } as unknown as DeviceIdentity

  beforeEach(() => {
    vi.useFakeTimers()
    openExternalMock.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
  })

  it('publishes managed key after checkout polling succeeds', async () => {
    globalThis.fetch = makeFetchMock([
      jsonResponse({ url: inBackendDomain('/checkout?token=signed-jwt') }),
      jsonResponse({ key: null }),
      jsonResponse({ key: 'sk-or-customer' }),
    ])

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
    expect(updates.at(-1)?.payload).toEqual({
      config: { provider: 'openrouter', apiKey: 'sk-or-customer' },
    })
  })

  it('sends device_id as a Bearer token (not in the URL) when fetching the customer key', async () => {
    const fetchMock = makeFetchMock([
      jsonResponse({ url: inBackendDomain('/checkout?token=t') }),
      jsonResponse({ key: null }),
      jsonResponse({ key: 'sk-or-customer' }),
    ])
    globalThis.fetch = fetchMock

    const provider = new CustomerAccessProvider(deviceIdentity)
    await provider.startCheckout('explorer')
    await vi.advanceTimersByTimeAsync(MANAGED_KEY_CONFIG.POLL_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(MANAGED_KEY_CONFIG.POLL_INTERVAL_MS)

    const keyCall = findCall(fetchMock, '/v2/subscription/key')
    expect(String(keyCall[0])).not.toContain('device_id=')
    expect((keyCall[1]?.headers as Record<string, string>).Authorization).toBe('Bearer device-123')
  })

  it('mints a signed checkout link via Bearer-authed POST and opens the returned URL', async () => {
    const signedUrl = inBackendDomain('/checkout?token=signed-jwt')
    const fetchMock = makeFetchMock([jsonResponse({ url: signedUrl }), jsonResponse({ key: null })])
    globalThis.fetch = fetchMock

    const provider = new CustomerAccessProvider(deviceIdentity)
    await provider.startCheckout('explorer')

    const linkCall = findCall(fetchMock, '/v2/subscription/checkout-link')
    expect(linkCall[1]?.method).toBe('POST')
    expect((linkCall[1]?.headers as Record<string, string>).Authorization).toBe('Bearer device-123')
    expect(String(linkCall[0])).not.toContain('device_id=')
    expect(JSON.parse(String(linkCall[1]?.body))).toEqual({ plan: 'explorer' })

    expect(openExternalMock).toHaveBeenCalledWith(signedUrl)
    const openedUrl = openExternalMock.mock.calls[0]?.[0] as string
    expect(openedUrl).not.toContain('device_id=')
  })

  it('does not open the browser or start polling if checkout-link minting fails', async () => {
    globalThis.fetch = makeFetchMock([jsonResponse({}, false, 500)])

    const provider = new CustomerAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null }> = []
    provider.setUpdateCallback((state) => {
      updates.push({ status: state.customerSubscriptionStatus })
    })

    await provider.startCheckout('explorer')

    expect(openExternalMock).not.toHaveBeenCalled()
    expect(updates.map((u) => u.status)).not.toContain('polling')
  })

  it('mints a signed portal link via Bearer-authed POST and opens the returned URL', async () => {
    const signedUrl = inBackendDomain('/portal?token=signed-jwt')
    const fetchMock = makeFetchMock([jsonResponse({ url: signedUrl })])
    globalThis.fetch = fetchMock

    const provider = new CustomerAccessProvider(deviceIdentity)
    await provider.openSubscriptionPortal()

    const linkCall = findCall(fetchMock, '/v2/subscription/portal-link')
    expect(linkCall[1]?.method).toBe('POST')
    expect((linkCall[1]?.headers as Record<string, string>).Authorization).toBe('Bearer device-123')
    expect(String(linkCall[0])).not.toContain('device_id=')

    expect(openExternalMock).toHaveBeenCalledWith(signedUrl)
    const openedUrl = openExternalMock.mock.calls[0]?.[0] as string
    expect(openedUrl).not.toContain('device_id=')
  })

  it('rejects checkout URLs outside the backend registrable domain', async () => {
    globalThis.fetch = makeFetchMock([
      jsonResponse({ url: 'https://attacker.example/phishing?token=x' }),
    ])

    const provider = new CustomerAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null }> = []
    provider.setUpdateCallback((state) => {
      updates.push({ status: state.customerSubscriptionStatus })
    })

    await provider.startCheckout('explorer')

    expect(openExternalMock).not.toHaveBeenCalled()
    expect(updates.map((u) => u.status)).not.toContain('polling')
  })

  it('rejects portal URLs outside the backend registrable domain', async () => {
    globalThis.fetch = makeFetchMock([
      jsonResponse({ url: 'https://attacker.example/portal?token=x' }),
    ])

    const provider = new CustomerAccessProvider(deviceIdentity)
    await expect(provider.openSubscriptionPortal()).rejects.toThrow(/outside backend domain/)
    expect(openExternalMock).not.toHaveBeenCalled()
  })
})
