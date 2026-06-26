import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { RemoteCapturePolicyService } from './remote-capture-policy-service'

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

describe('RemoteCapturePolicyService', () => {
  const originalFetch = globalThis.fetch

  function makeService(
    overrides: Partial<{
      isActivated: () => boolean
      onChange: () => void
    }> = {},
  ) {
    const onChange = overrides.onChange ?? vi.fn()
    const service = new RemoteCapturePolicyService({
      getDeviceId: () => 'device-123',
      isActivated: overrides.isActivated ?? (() => true),
      getBackendUrl: () => 'https://backend.test',
      onChange,
    })
    return { service, onChange }
  }

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('fetches with the device bearer and exposes the synced policy', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ excludedApps: ['slack', 1, 'msedge'], excludedUrlPatterns: ['*bank*'] }),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { service, onChange } = makeService()
    await service.sync()

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    // The client sends its platform so the backend returns only matchable tokens.
    const expectedPlatform =
      process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : null
    expect(String(url)).toBe(
      `https://backend.test/api/license/capture-policy${expectedPlatform ? `?platform=${expectedPlatform}` : ''}`,
    )
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer device-123')
    // Non-string entries are dropped.
    expect(service.getPolicy()).toEqual({
      apps: ['slack', 'msedge'],
      urlPatterns: ['*bank*'],
    })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('does not fetch or notify when the device is not activated', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { service, onChange } = makeService({ isActivated: () => false })
    await service.sync()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(service.getPolicy()).toEqual({ apps: [], urlPatterns: [] })
  })

  it('notifies only when the policy actually changes', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ excludedApps: ['slack'], excludedUrlPatterns: [] }),
    ) as unknown as typeof fetch

    const { service, onChange } = makeService()
    await service.sync()
    await service.sync()

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('clears the policy on 401 (device no longer bound) and notifies', async () => {
    const responses: Response[] = [
      jsonResponse({ excludedApps: ['slack'], excludedUrlPatterns: ['*bank*'] }),
      { ok: false, status: 401, json: async () => ({}) } as unknown as Response,
    ]
    globalThis.fetch = vi.fn(async () => responses.shift() as Response) as unknown as typeof fetch

    const { service, onChange } = makeService()
    await service.sync()
    expect(service.getPolicy().apps).toEqual(['slack'])

    await service.sync()
    expect(service.getPolicy()).toEqual({ apps: [], urlPatterns: [] })
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('keeps the last policy and swallows the error on a failed fetch', async () => {
    const responses: Response[] = [
      jsonResponse({ excludedApps: ['slack'], excludedUrlPatterns: [] }),
      { ok: false, status: 500, json: async () => ({}) } as unknown as Response,
    ]
    globalThis.fetch = vi.fn(async () => responses.shift() as Response) as unknown as typeof fetch

    const { service, onChange } = makeService()
    await service.sync()
    await expect(service.sync()).resolves.toBeUndefined()

    expect(service.getPolicy().apps).toEqual(['slack'])
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
