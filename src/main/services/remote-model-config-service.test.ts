import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import type { RemoteModelConfig } from '../../shared/remote-model-config'
import { RemoteModelConfigService } from './remote-model-config-service'
import { jsonResponse } from '@main/utils/test-utils'

const CONFIG_V1: RemoteModelConfig = {
  version: 1,
  models: { taskMining: ['minimax/minimax-m3'] },
}

describe('RemoteModelConfigService', () => {
  const originalFetch = globalThis.fetch

  function makeService(
    overrides: Partial<{
      isActivated: () => boolean
      onChange: (config: RemoteModelConfig) => void
      readStored: () => RemoteModelConfig | null
      writeStored: (config: RemoteModelConfig) => void
    }> = {},
  ) {
    const onChange = overrides.onChange ?? vi.fn()
    const service = new RemoteModelConfigService({
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
    vi.useRealTimers()
  })

  it('fetches with the device bearer and exposes the synced config', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse(CONFIG_V1))
    globalThis.fetch = fetchMock

    const { service, onChange } = makeService()
    await service.sync()

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('https://backend.test/api/config/models')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer device-123')
    expect(service.getConfig()).toEqual(CONFIG_V1)
    expect(onChange).toHaveBeenCalledWith(CONFIG_V1)
  })

  it('does not fetch or notify when the device is not activated', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    globalThis.fetch = fetchMock

    const { service, onChange } = makeService({ isActivated: () => false })
    await service.sync()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(service.getConfig()).toBeNull()
  })

  it('notifies and persists only when the config actually changes', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => jsonResponse(CONFIG_V1))

    const writeStored = vi.fn()
    const { service, onChange } = makeService({ writeStored })
    await service.sync()
    await service.sync()

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(writeStored).toHaveBeenCalledTimes(1)
    expect(writeStored).toHaveBeenCalledWith(CONFIG_V1)
  })

  it('keeps the last config on a non-200 (endpoint not yet deployed)', async () => {
    const responses: Response[] = [jsonResponse(CONFIG_V1), jsonResponse({}, false, 404)]
    globalThis.fetch = vi.fn<typeof fetch>(async () => responses.shift() as Response)

    const { service, onChange } = makeService()
    await service.sync()
    await expect(service.sync()).resolves.toBeUndefined()

    expect(service.getConfig()).toEqual(CONFIG_V1)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('keeps the last config on a malformed body', async () => {
    const responses: Response[] = [
      jsonResponse(CONFIG_V1),
      jsonResponse({ version: 'not-a-number', models: {} }),
    ]
    globalThis.fetch = vi.fn<typeof fetch>(async () => responses.shift() as Response)

    const { service, onChange } = makeService()
    await service.sync()
    await service.sync()

    expect(service.getConfig()).toEqual(CONFIG_V1)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('loads the cached config on start() and applies it before any fetch', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => jsonResponse(CONFIG_V1))

    const { service, onChange } = makeService({ readStored: () => CONFIG_V1 })
    service.start()
    service.stop()

    // Applied and broadcast synchronously, before the async first sync resolves.
    expect(service.getConfig()).toEqual(CONFIG_V1)
    expect(onChange).toHaveBeenCalledWith(CONFIG_V1)
  })

  it('retries on a short backoff until the first config arrives', async () => {
    vi.useFakeTimers()
    const responses: Response[] = [jsonResponse({}, false, 500), jsonResponse(CONFIG_V1)]
    const fetchMock = vi.fn<typeof fetch>(async () => responses.shift() ?? jsonResponse(CONFIG_V1))
    globalThis.fetch = fetchMock

    const { service, onChange } = makeService()
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getConfig()).toBeNull()

    await vi.advanceTimersByTimeAsync(15_000)
    expect(service.getConfig()).toEqual(CONFIG_V1)
    expect(onChange).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    service.stop()
  })

  it('does not fast-retry once a config is held', async () => {
    vi.useFakeTimers()
    const responses: Response[] = [jsonResponse(CONFIG_V1)]
    const fetchMock = vi.fn<typeof fetch>(
      async () => responses.shift() ?? jsonResponse({}, false, 500),
    )
    globalThis.fetch = fetchMock

    const { service } = makeService()
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(service.getConfig()).toEqual(CONFIG_V1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    service.stop()
  })

  it('stop() cancels a pending first-value retry', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({}, false, 500))
    globalThis.fetch = fetchMock

    const { service } = makeService()
    service.start()
    await vi.advanceTimersByTimeAsync(0)
    service.stop()

    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats a missing cache on start() as a no-op', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => jsonResponse(CONFIG_V1))

    const { service, onChange } = makeService({ readStored: () => null })
    service.start()
    service.stop()

    expect(onChange).not.toHaveBeenCalled()
  })
})
