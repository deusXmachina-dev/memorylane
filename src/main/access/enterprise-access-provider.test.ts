import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { EnterpriseAccessProvider } from './enterprise-access-provider'
import { ENTERPRISE_BACKEND_CONFIG } from '../../shared/constants'
import { DeviceIdentityUnavailableError, type DeviceIdentity } from '../settings/device-identity'

const TENANT_TOKEN = 'tt_GigKRAyNbQ1U8jBSEKTq7uiiufT392Si'
const EMAIL = 'alice@corp.com'

function urlsafeBase64(value: string): string {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

const ACTIVATION_CODE = `${TENANT_TOKEN}.${urlsafeBase64(EMAIL)}`

const DEFAULT_DOC_BYTES = Buffer.from('%PDF-1.4 fake consent doc')
const DEFAULT_DOC_SHA = createHash('sha256').update(DEFAULT_DOC_BYTES).digest('hex')

function descriptorResponse(
  overrides: {
    sha256?: string
    contentType?: string
    version?: number
    title?: string
    url?: string
  } = {},
): Response {
  return {
    ok: true,
    json: async () => ({
      url: overrides.url ?? `/api/license/consent-document/${overrides.sha256 ?? DEFAULT_DOC_SHA}`,
      version: overrides.version ?? 3,
      sha256: overrides.sha256 ?? DEFAULT_DOC_SHA,
      title: overrides.title ?? 'Employee data consent',
      content_type: overrides.contentType ?? 'application/pdf',
    }),
  } as unknown as Response
}

function pdfResponse(bytes: Buffer = DEFAULT_DOC_BYTES): Response {
  return {
    ok: true,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response
}

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

  it('parks in awaiting_consent after fetching descriptor and verifying the PDF', async () => {
    const responses = [descriptorResponse(), pdfResponse()]
    globalThis.fetch = vi.fn(async () => responses.shift() as Response) as typeof fetch

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null }> = []
    provider.setUpdateCallback((state) => {
      updates.push({ status: state.enterpriseActivationStatus })
    })

    await provider.activateEnterpriseLicense(ACTIVATION_CODE)

    expect(updates.at(-1)?.status).toBe('awaiting_consent')
    const consent = await provider.getPendingConsent()
    expect(consent?.bytesBase64).toBe(DEFAULT_DOC_BYTES.toString('base64'))
    expect(consent?.contentType).toBe('application/pdf')
  })

  it('rejects malformed activation codes without making any network calls', async () => {
    const fetchMock = vi.fn() as unknown as typeof fetch
    globalThis.fetch = fetchMock

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null; error: string | null }> = []
    provider.setUpdateCallback((state) => {
      updates.push({ status: state.enterpriseActivationStatus, error: state.error })
    })

    await expect(provider.activateEnterpriseLicense('not-a-code')).rejects.toThrow(
      /must start with `tt_`/,
    )
    expect((fetchMock as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0)
    expect(updates.at(-1)?.status).toBe('error')
  })

  it('rejects descriptors with disallowed content types', async () => {
    globalThis.fetch = vi.fn(async () =>
      descriptorResponse({ contentType: 'text/html' }),
    ) as unknown as typeof fetch

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null }> = []
    provider.setUpdateCallback((state) => {
      updates.push({ status: state.enterpriseActivationStatus })
    })

    await expect(provider.activateEnterpriseLicense(ACTIVATION_CODE)).rejects.toThrow()
    expect(updates.at(-1)?.status).toBe('error')
  })

  it('rejects descriptors whose url points off the configured backend origin', async () => {
    const responses = [descriptorResponse({ url: 'https://attacker.example/leak' })]
    const fetchMock = vi.fn(async () => responses.shift() as Response) as unknown as typeof fetch
    globalThis.fetch = fetchMock

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null; error: string | null }> = []
    provider.setUpdateCallback((state) => {
      updates.push({ status: state.enterpriseActivationStatus, error: state.error })
    })

    await expect(provider.activateEnterpriseLicense(ACTIVATION_CODE)).rejects.toThrow(
      /backend origin/i,
    )
    // Descriptor was fetched, but the off-origin document fetch must not have happened.
    const calls = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls
    expect(calls).toHaveLength(1)
    expect(String(calls[0][0])).toContain('/license/consent-document')
    expect(updates.at(-1)?.status).toBe('error')
  })

  it('rejects a consent document whose hash does not match the descriptor', async () => {
    const responses = [
      descriptorResponse({ sha256: 'a'.repeat(64) }),
      pdfResponse(Buffer.from([1, 2, 3, 4])),
    ]
    globalThis.fetch = vi.fn(async () => responses.shift() as Response) as typeof fetch

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null }> = []
    provider.setUpdateCallback((state) => {
      updates.push({ status: state.enterpriseActivationStatus })
    })

    await expect(provider.activateEnterpriseLicense(ACTIVATION_CODE)).rejects.toThrow(
      /integrity check/i,
    )
    expect(updates.at(-1)?.status).toBe('error')
  })

  it('skips consent UI and binds via external consent when backend returns already_approved', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = []
    const responses = [
      // GET /license/consent-document -> already_approved sentinel
      {
        ok: true,
        json: async () => ({ state: 'already_approved', version: 0 }),
      } as unknown as Response,
      // POST /license/activate (outcome=accepted, no document_version)
      { ok: true, json: async () => ({ ok: true }) } as unknown as Response,
      // GET /license/status (poll #1: activated)
      { ok: true, json: async () => ({ activated: true }) } as unknown as Response,
      // GET /license/inference-config
      {
        ok: true,
        json: async () => ({
          provider: 'openrouter',
          apiKey: 'sk-or-enterprise',
          project: null,
          location: null,
          expiresAt: null,
        }),
      } as unknown as Response,
    ]
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init })
      return responses.shift() as Response
    }) as typeof fetch

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null; payload?: unknown }> = []
    provider.setUpdateCallback((state, payload) => {
      updates.push({ status: state.enterpriseActivationStatus, payload })
    })

    await provider.activateEnterpriseLicense(ACTIVATION_CODE)
    await vi.advanceTimersByTimeAsync(ENTERPRISE_BACKEND_CONFIG.POLL_INTERVAL_MS)

    expect(updates.some((u) => u.status === 'awaiting_consent')).toBe(false)
    expect(await provider.getPendingConsent()).toBeNull()

    const activateCall = fetchCalls.find((c) => c.url.includes('/license/activate'))
    expect(activateCall).toBeDefined()
    const activateBody = JSON.parse(String(activateCall?.init?.body)) as Record<string, unknown>
    expect(activateBody).toMatchObject({
      tenant_token: TENANT_TOKEN,
      device_id: 'device-123',
      email: EMAIL,
      outcome: 'accepted',
    })
    expect(activateBody).not.toHaveProperty('document_version')

    expect(updates.at(-1)?.status).toBe('activated')
    expect(updates.at(-1)?.payload).toEqual({
      config: { provider: 'openrouter', apiKey: 'sk-or-enterprise' },
    })
  })

  it('treats 502 on external-consent bind as provisional success and starts polling', async () => {
    const responses = [
      // GET /license/consent-document -> already_approved sentinel
      {
        ok: true,
        json: async () => ({ state: 'already_approved' }),
      } as unknown as Response,
      // POST /license/activate fails with 502
      {
        ok: false,
        status: 502,
        json: async () => ({ error: 'upstream' }),
      } as unknown as Response,
      // poll resolves anyway
      { ok: true, json: async () => ({ activated: true }) } as unknown as Response,
      {
        ok: true,
        json: async () => ({
          provider: 'openrouter',
          apiKey: 'sk-or-enterprise',
          project: null,
          location: null,
          expiresAt: null,
        }),
      } as unknown as Response,
    ]
    globalThis.fetch = vi.fn(async () => responses.shift() as Response) as typeof fetch

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null }> = []
    provider.setUpdateCallback((state) => {
      updates.push({ status: state.enterpriseActivationStatus })
    })

    await provider.activateEnterpriseLicense(ACTIVATION_CODE)
    await vi.advanceTimersByTimeAsync(ENTERPRISE_BACKEND_CONFIG.POLL_INTERVAL_MS)

    expect(updates.some((u) => u.status === 'awaiting_consent')).toBe(false)
    expect(updates.at(-1)?.status).toBe('activated')
  })

  it('rejects descriptors with an unknown state value as malformed', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ state: 'pending_review' }),
    })) as unknown as typeof fetch

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null; error: string | null }> = []
    provider.setUpdateCallback((state) => {
      updates.push({ status: state.enterpriseActivationStatus, error: state.error })
    })

    await expect(provider.activateEnterpriseLicense(ACTIVATION_CODE)).rejects.toThrow(/malformed/i)
    expect(updates.at(-1)?.status).toBe('error')
  })

  it('activates and polls for the key after consent is accepted', async () => {
    const responses = [
      descriptorResponse(),
      pdfResponse(),
      // POST /license/activate
      { ok: true, json: async () => ({ ok: true }) } as unknown as Response,
      // GET /license/status (poll #1: activated)
      { ok: true, json: async () => ({ activated: true }) } as unknown as Response,
      // GET /license/inference-config
      {
        ok: true,
        json: async () => ({
          provider: 'openrouter',
          apiKey: 'sk-or-enterprise',
          project: null,
          location: null,
          expiresAt: null,
        }),
      } as unknown as Response,
    ]
    globalThis.fetch = vi.fn(async () => responses.shift() as Response) as typeof fetch

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null; payload?: unknown }> = []
    provider.setUpdateCallback((state, payload) => {
      updates.push({ status: state.enterpriseActivationStatus, payload })
    })

    await provider.activateEnterpriseLicense(ACTIVATION_CODE)
    expect(updates.at(-1)?.status).toBe('awaiting_consent')

    await provider.submitConsentDecision('accepted')
    await vi.advanceTimersByTimeAsync(ENTERPRISE_BACKEND_CONFIG.POLL_INTERVAL_MS)

    expect(updates.at(-1)?.status).toBe('activated')
    expect(updates.at(-1)?.payload).toEqual({
      config: { provider: 'openrouter', apiKey: 'sk-or-enterprise' },
    })
  })

  it('keeps the consent prompt open and throws a retry error when identity is unavailable at consent submit', async () => {
    const responses = [descriptorResponse(), pdfResponse()]
    const fetchMock = vi.fn(async () => responses.shift() as Response) as typeof fetch
    globalThis.fetch = fetchMock
    const throwingIdentity = {
      getDeviceId: () => {
        throw new DeviceIdentityUnavailableError('secure storage unavailable')
      },
    } as unknown as DeviceIdentity

    const provider = new EnterpriseAccessProvider(throwingIdentity)
    const updates: Array<{ status: string | null }> = []
    provider.setUpdateCallback((state) => {
      updates.push({ status: state.enterpriseActivationStatus })
    })

    await provider.activateEnterpriseLicense(ACTIVATION_CODE)
    expect(updates.at(-1)?.status).toBe('awaiting_consent')
    const fetchCountAfterActivate = (fetchMock as unknown as { mock: { calls: unknown[] } }).mock
      .calls.length

    await expect(provider.submitConsentDecision('accepted')).rejects.toThrow(
      /temporarily unavailable/i,
    )

    // No activate POST was attempted, the prompt stays open, and we did not
    // fall into the error state — the user can simply retry.
    expect((fetchMock as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      fetchCountAfterActivate,
    )
    expect(updates.at(-1)?.status).toBe('awaiting_consent')
    expect(await provider.getPendingConsent()).not.toBeNull()
  })

  it('completes activation with a Vertex inference config and schedules a token refresh', async () => {
    const expiresAtSec = Math.floor(Date.now() / 1000) + 3600
    const responses = [
      descriptorResponse(),
      pdfResponse(),
      { ok: true, json: async () => ({ ok: true }) } as unknown as Response,
      { ok: true, json: async () => ({ activated: true }) } as unknown as Response,
      {
        ok: true,
        json: async () => ({
          provider: 'vertex',
          apiKey: 'ya29.fake-token',
          project: 'demo-project-42',
          location: 'us-central1',
          expiresAt: expiresAtSec,
        }),
      } as unknown as Response,
      // Refetch ~60s before expiresAt — second inference-config call.
      { ok: true, json: async () => ({ activated: true }) } as unknown as Response,
      {
        ok: true,
        json: async () => ({
          provider: 'vertex',
          apiKey: 'ya29.refreshed-token',
          project: 'demo-project-42',
          location: 'us-central1',
          expiresAt: expiresAtSec + 3600,
        }),
      } as unknown as Response,
    ]
    globalThis.fetch = vi.fn(async () => responses.shift() as Response) as typeof fetch

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null; payload?: unknown }> = []
    provider.setUpdateCallback((state, payload) => {
      updates.push({ status: state.enterpriseActivationStatus, payload })
    })

    await provider.activateEnterpriseLicense(ACTIVATION_CODE)
    await provider.submitConsentDecision('accepted')
    await vi.advanceTimersByTimeAsync(ENTERPRISE_BACKEND_CONFIG.POLL_INTERVAL_MS)

    expect(updates.at(-1)?.status).toBe('activated')
    expect(updates.at(-1)?.payload).toEqual({
      config: {
        provider: 'vertex',
        apiKey: 'ya29.fake-token',
        project: 'demo-project-42',
        location: 'us-central1',
        expiresAt: expiresAtSec,
      },
    })

    // Token-refresh fires ~60s before expiresAt: advance the full 1h.
    await vi.advanceTimersByTimeAsync(3600 * 1000)

    expect(updates.at(-1)?.status).toBe('activated')
    expect(
      (updates.at(-1)?.payload as { config?: { apiKey: string } } | undefined)?.config?.apiKey,
    ).toBe('ya29.refreshed-token')
  })

  it('sends tenant_token, device_id, email, document_version and outcome on /activate', async () => {
    const responses = [
      descriptorResponse({ version: 7 }),
      pdfResponse(),
      { ok: true, json: async () => ({ ok: true }) } as unknown as Response,
      { ok: true, json: async () => ({ activated: true }) } as unknown as Response,
      {
        ok: true,
        json: async () => ({
          provider: 'openrouter',
          apiKey: 'sk-or-enterprise',
          project: null,
          location: null,
          expiresAt: null,
        }),
      } as unknown as Response,
    ]
    const fetchMock = vi.fn(async () => responses.shift() as Response) as unknown as typeof fetch
    globalThis.fetch = fetchMock

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    await provider.activateEnterpriseLicense(ACTIVATION_CODE)
    await provider.submitConsentDecision('accepted')

    const calls = (fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls
    const activateCall = calls.find((c) => String(c[0]).includes('/license/activate'))
    expect(activateCall).toBeDefined()
    const init = activateCall![1] as RequestInit
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TENANT_TOKEN}`)
    expect(JSON.parse(init.body as string)).toEqual({
      tenant_token: TENANT_TOKEN,
      device_id: 'device-123',
      email: EMAIL,
      document_version: 7,
      outcome: 'accepted',
    })
  })

  it('sends Bearer auth and no query params on activation, status, and inference-config endpoints', async () => {
    const responses = [
      descriptorResponse(),
      pdfResponse(),
      { ok: true, json: async () => ({ ok: true }) } as unknown as Response,
      { ok: true, json: async () => ({ activated: true }) } as unknown as Response,
      {
        ok: true,
        json: async () => ({
          provider: 'openrouter',
          apiKey: 'sk-or-enterprise',
          project: null,
          location: null,
          expiresAt: null,
        }),
      } as unknown as Response,
    ]
    const fetchMock = vi.fn(async () => responses.shift() as Response) as unknown as typeof fetch
    globalThis.fetch = fetchMock

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    await provider.activateEnterpriseLicense(ACTIVATION_CODE)
    await provider.submitConsentDecision('accepted')
    await vi.advanceTimersByTimeAsync(ENTERPRISE_BACKEND_CONFIG.POLL_INTERVAL_MS)

    const calls = (
      fetchMock as unknown as { mock: { calls: [unknown, RequestInit | undefined][] } }
    ).mock.calls

    const descriptorCall = calls.find((c) => String(c[0]).includes('/license/consent-document'))!
    expect(String(descriptorCall[0])).not.toContain('tenant_token=')
    expect((descriptorCall[1]?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TENANT_TOKEN}`,
    )

    const statusCall = calls.find((c) => String(c[0]).includes('/license/status'))!
    expect(String(statusCall[0])).not.toContain('device_id=')
    expect((statusCall[1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer device-123',
    )

    const configCall = calls.find((c) => String(c[0]).includes('/license/inference-config'))!
    expect(String(configCall[0])).not.toContain('device_id=')
    expect((configCall[1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer device-123',
    )
  })

  it('returns to inactive when consent is declined', async () => {
    const responses = [
      descriptorResponse(),
      pdfResponse(),
      { ok: true, json: async () => ({ declined: true }) } as unknown as Response,
    ]
    globalThis.fetch = vi.fn(async () => responses.shift() as Response) as typeof fetch

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null }> = []
    provider.setUpdateCallback((state) => {
      updates.push({ status: state.enterpriseActivationStatus })
    })

    await provider.activateEnterpriseLicense(ACTIVATION_CODE)
    await provider.submitConsentDecision('declined')

    expect(updates.at(-1)?.status).toBe('inactive')
  })

  it('treats 502 on accept as provisional success and starts polling', async () => {
    const responses = [
      descriptorResponse(),
      pdfResponse(),
      // POST /license/activate fails with 502
      {
        ok: false,
        status: 502,
        json: async () => ({ error: 'upstream' }),
      } as unknown as Response,
      // poll resolves anyway
      { ok: true, json: async () => ({ activated: true }) } as unknown as Response,
      {
        ok: true,
        json: async () => ({
          provider: 'openrouter',
          apiKey: 'sk-or-enterprise',
          project: null,
          location: null,
          expiresAt: null,
        }),
      } as unknown as Response,
    ]
    globalThis.fetch = vi.fn(async () => responses.shift() as Response) as typeof fetch

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null }> = []
    provider.setUpdateCallback((state) => {
      updates.push({ status: state.enterpriseActivationStatus })
    })

    await provider.activateEnterpriseLicense(ACTIVATION_CODE)
    await provider.submitConsentDecision('accepted')
    await vi.advanceTimersByTimeAsync(ENTERPRISE_BACKEND_CONFIG.POLL_INTERVAL_MS)

    expect(updates.at(-1)?.status).toBe('activated')
  })

  it('treats 502 on decline as an error', async () => {
    const responses = [
      descriptorResponse(),
      pdfResponse(),
      {
        ok: false,
        status: 502,
        json: async () => ({ error: 'Upstream failed' }),
      } as unknown as Response,
    ]
    globalThis.fetch = vi.fn(async () => responses.shift() as Response) as typeof fetch

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null }> = []
    provider.setUpdateCallback((state) => {
      updates.push({ status: state.enterpriseActivationStatus })
    })

    await provider.activateEnterpriseLicense(ACTIVATION_CODE)
    await expect(provider.submitConsentDecision('declined')).rejects.toThrow()
    expect(updates.at(-1)?.status).toBe('error')
  })

  it('skips refresh while awaiting_consent', async () => {
    const responses = [descriptorResponse(), pdfResponse()]
    const fetchMock = vi.fn(
      async () => (responses.shift() ?? descriptorResponse()) as Response,
    ) as unknown as typeof fetch
    globalThis.fetch = fetchMock

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    await provider.activateEnterpriseLicense(ACTIVATION_CODE)

    const before = (fetchMock as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    await provider.refreshAccessState()
    const after = (fetchMock as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    expect(after).toBe(before)
  })

  it('times out the consent decision and surfaces an error', async () => {
    const responses = [descriptorResponse(), pdfResponse()]
    globalThis.fetch = vi.fn(async () => responses.shift() as Response) as typeof fetch

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null; error: string | null }> = []
    provider.setUpdateCallback((state) => {
      updates.push({
        status: state.enterpriseActivationStatus,
        error: state.error,
      })
    })

    await provider.activateEnterpriseLicense(ACTIVATION_CODE)
    expect(updates.at(-1)?.status).toBe('awaiting_consent')

    await vi.advanceTimersByTimeAsync(ENTERPRISE_BACKEND_CONFIG.CONSENT_DECISION_TIMEOUT_MS)

    expect(updates.at(-1)?.status).toBe('error')
    expect(updates.at(-1)?.error).toMatch(/timed out/i)
  })

  it('treats 401 on /status as inactive (unknown device pre-activation)', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    })) as unknown as typeof fetch

    const provider = new EnterpriseAccessProvider(deviceIdentity)
    const updates: Array<{ status: string | null; error: string | null }> = []
    provider.setUpdateCallback((state) => {
      updates.push({ status: state.enterpriseActivationStatus, error: state.error })
    })

    await provider.refreshAccessState()

    expect(updates.at(-1)?.status).toBe('inactive')
    expect(updates.at(-1)?.error).toBeNull()
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
