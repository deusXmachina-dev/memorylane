import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { DeviceReportSync } from './device-report-sync'
import { DeviceIdentityUnavailableError } from '../settings/device-identity'

const EXPECTED_PLATFORM =
  process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : null

function okResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}) } as unknown as Response
}

function errorResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}) } as unknown as Response
}

describe('DeviceReportSync', () => {
  const originalFetch = globalThis.fetch

  function makeService(
    overrides: Partial<{
      getDeviceId: () => string
      getBackendUrl: () => string
      getVersion: () => string
      readStored: () => { version: string | null } | null
      writeStored: (state: { version: string | null }) => void
    }> = {},
  ) {
    const writeStored = overrides.writeStored ?? vi.fn()
    const service = new DeviceReportSync({
      getDeviceId: overrides.getDeviceId ?? (() => 'device-123'),
      getBackendUrl: overrides.getBackendUrl ?? (() => 'https://backend.test'),
      getVersion: overrides.getVersion ?? (() => '1.3.0'),
      edition: 'customer',
      readStored: overrides.readStored,
      writeStored,
    })
    return { service, writeStored }
  }

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('POSTs the version with the device bearer to api/device/report', async () => {
    const fetchMock = vi.fn(async () => okResponse())
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { service, writeStored } = makeService()
    await service.sync()

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://backend.test/api/device/report')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer device-123')
    expect(JSON.parse(init.body as string)).toEqual({
      app_version: '1.3.0',
      platform: EXPECTED_PLATFORM,
    })
    expect(writeStored).toHaveBeenCalledWith({ version: '1.3.0' })
  })

  it('does not POST when the stored version already matches (loaded on start)', async () => {
    const fetchMock = vi.fn(async () => okResponse())
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { service } = makeService({ readStored: () => ({ version: '1.3.0' }) })
    service.start()
    service.stop()
    await service.sync()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTs once, then stays quiet on subsequent syncs (report only on change)', async () => {
    const fetchMock = vi.fn(async () => okResponse())
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { service } = makeService()
    await service.sync()
    await service.sync()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not POST when the backend URL is empty', async () => {
    const fetchMock = vi.fn(async () => okResponse())
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { service } = makeService({ getBackendUrl: () => '' })
    await service.sync()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not record the version on a non-200 and retries on the next sync', async () => {
    const responses: Response[] = [errorResponse(500), okResponse()]
    const fetchMock = vi.fn(async () => responses.shift() as Response)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { service, writeStored } = makeService()
    await expect(service.sync()).resolves.toBeUndefined()
    expect(writeStored).not.toHaveBeenCalled()

    // The version was never confirmed, so the next tick retries and lands.
    await service.sync()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(writeStored).toHaveBeenCalledWith({ version: '1.3.0' })
  })

  it('swallows a transient device-identity error and does not advance state', async () => {
    const fetchMock = vi.fn(async () => okResponse())
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { service, writeStored } = makeService({
      getDeviceId: () => {
        throw new DeviceIdentityUnavailableError('secure storage unavailable')
      },
    })
    await expect(service.sync()).resolves.toBeUndefined()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(writeStored).not.toHaveBeenCalled()
  })
})
