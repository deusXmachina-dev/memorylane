import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { RemoteBlacklistService } from './remote-blacklist-service'

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response
}

describe('RemoteBlacklistService', () => {
  const originalFetch = globalThis.fetch

  function makeService(
    overrides: Partial<{
      isActivated: () => boolean
      onChange: () => void
      readStored: () => { apps: string[]; urlPatterns: string[] } | null
      writeStored: (blacklist: { apps: string[]; urlPatterns: string[] }) => void
    }> = {},
  ) {
    const onChange = overrides.onChange ?? vi.fn()
    const service = new RemoteBlacklistService({
      getDeviceId: () => 'device-123',
      isActivated: overrides.isActivated ?? (() => true),
      getBackendUrl: () => 'https://backend.test',
      onChange,
      readStored: overrides.readStored,
      writeStored: overrides.writeStored,
    })
    return { service, onChange }
  }

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('fetches with the device bearer and exposes the synced blacklist', async () => {
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
      `https://backend.test/api/license/blacklist${expectedPlatform ? `?platform=${expectedPlatform}` : ''}`,
    )
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer device-123')
    // Non-string entries are dropped.
    expect(service.getBlacklist()).toEqual({
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
    expect(service.getBlacklist()).toEqual({ apps: [], urlPatterns: [] })
  })

  it('notifies only when the blacklist actually changes', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ excludedApps: ['slack'], excludedUrlPatterns: [] }),
    ) as unknown as typeof fetch

    const { service, onChange } = makeService()
    await service.sync()
    await service.sync()

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('keeps the last blacklist on 401 (does not clear on deactivation)', async () => {
    const responses: Response[] = [
      jsonResponse({ excludedApps: ['slack'], excludedUrlPatterns: ['*bank*'] }),
      { ok: false, status: 401, json: async () => ({}) } as unknown as Response,
    ]
    globalThis.fetch = vi.fn(async () => responses.shift() as Response) as unknown as typeof fetch

    const { service, onChange } = makeService()
    await service.sync()
    expect(service.getBlacklist().apps).toEqual(['slack'])

    await service.sync()
    // 401 is treated like any other failure: the last-known list is retained.
    expect(service.getBlacklist().apps).toEqual(['slack'])
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('keeps the last blacklist and swallows the error on a failed fetch', async () => {
    const responses: Response[] = [
      jsonResponse({ excludedApps: ['slack'], excludedUrlPatterns: [] }),
      { ok: false, status: 500, json: async () => ({}) } as unknown as Response,
    ]
    globalThis.fetch = vi.fn(async () => responses.shift() as Response) as unknown as typeof fetch

    const { service, onChange } = makeService()
    await service.sync()
    await expect(service.sync()).resolves.toBeUndefined()

    expect(service.getBlacklist().apps).toEqual(['slack'])
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('clears the blacklist only on a real 200 with an empty list, and persists it', async () => {
    const responses: Response[] = [
      jsonResponse({ excludedApps: ['slack'], excludedUrlPatterns: [] }),
      jsonResponse({ excludedApps: [], excludedUrlPatterns: [] }),
    ]
    globalThis.fetch = vi.fn(async () => responses.shift() as Response) as unknown as typeof fetch

    const writeStored = vi.fn()
    const { service, onChange } = makeService({ writeStored })
    await service.sync()
    await service.sync()

    expect(service.getBlacklist()).toEqual({ apps: [], urlPatterns: [] })
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(writeStored).toHaveBeenLastCalledWith({ apps: [], urlPatterns: [] })
  })

  it('persists the blacklist to the store whenever it changes', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ excludedApps: ['slack'], excludedUrlPatterns: ['*bank*'] }),
    ) as unknown as typeof fetch

    const writeStored = vi.fn()
    const { service } = makeService({ writeStored })
    await service.sync()
    await service.sync()

    // Written once on the change; the unchanged second sync does not rewrite.
    expect(writeStored).toHaveBeenCalledTimes(1)
    expect(writeStored).toHaveBeenCalledWith({ apps: ['slack'], urlPatterns: ['*bank*'] })
  })

  it('loads the cached blacklist on start() and enforces it before any fetch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ excludedApps: [], excludedUrlPatterns: [] }))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const cached = { apps: ['slack'], urlPatterns: ['*bank*'] }
    const { service, onChange } = makeService({ readStored: () => cached })
    service.start()
    service.stop()

    // The cached list was applied and broadcast synchronously, before the async
    // first sync's fetch had a chance to resolve.
    expect(service.getBlacklist()).toEqual(cached)
    expect(onChange).toHaveBeenCalledWith(cached)
  })

  it('treats an empty/missing cache on start() as a no-op', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ excludedApps: [], excludedUrlPatterns: [] }),
    ) as unknown as typeof fetch

    const { service, onChange } = makeService({ readStored: () => null })
    service.start()
    service.stop()

    expect(onChange).not.toHaveBeenCalled()
  })
})
