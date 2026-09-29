import * as fs from 'fs'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('@main/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { BackendUpload, type BackendUploadParams, type UploadJob } from './backend-upload'
import log from '@main/utils/logger'
import { ManualHostEnvironment } from '@main/monitoring/host-environment'

function mockFetchResponse(status: number, body: object | string = { ok: true }) {
  return vi.fn<typeof fetch>(
    async () =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => (typeof body === 'object' ? body : JSON.parse(body)),
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      }) as Response,
  )
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

type FakeJob = UploadJob & {
  skipReason: Mock<() => string | null>
  produce: Mock<(tempPath: string) => Promise<Buffer>>
  onSuccess: Mock<(response: Response) => Promise<void>>
}

function fakeJob(overrides: Partial<FakeJob> = {}): FakeJob {
  return {
    name: 'FakeUpload',
    endpoint: 'api/device/fake',
    filename: 'fake.bin',
    skipReason: vi.fn<() => string | null>(() => null),
    produce: vi.fn(async (tempPath: string) => {
      fs.writeFileSync(tempPath, 'payload')
      return Buffer.from('payload')
    }),
    onSuccess: vi.fn(async () => {}),
    ...overrides,
  }
}

function makeUpload(
  overrides: Partial<BackendUploadParams> = {},
  jobOverrides: Partial<FakeJob> = {},
) {
  const job = fakeJob(jobOverrides)
  const upload = new BackendUpload({
    job,
    getDeviceId: () => 'device-hex-id',
    isActivated: () => true,
    isSyncEnabled: () => true,
    getBackendUrl: () => 'http://localhost:8000/',
    ...overrides,
  })
  return { upload, job }
}

describe('BackendUpload', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    globalThis.fetch = originalFetch
  })

  it('posts the produced bytes as multipart with Bearer auth', async () => {
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock
    const { upload, job } = makeUpload()

    upload.kick('startup')
    await upload.stop()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe('http://localhost:8000/api/device/fake')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer device-hex-id')
    const body = init.body as FormData
    expect(body.has('device_id')).toBe(false)
    const file = body.get('file') as File
    expect(file.name).toBe('fake.bin')
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('payload')
    expect(job.onSuccess).toHaveBeenCalledTimes(1)
  })

  it('skips when sharing is disabled', async () => {
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock
    const { upload, job } = makeUpload({ isSyncEnabled: () => false })

    upload.kick('startup')
    await upload.stop()

    expect(job.produce).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips when the device is not activated', async () => {
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock
    const { upload, job } = makeUpload({ isActivated: () => false })

    upload.kick('startup')
    await upload.stop()

    expect(job.produce).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips a scheduled run when the job reports a skip reason', async () => {
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock
    const { upload, job } = makeUpload({}, { skipReason: vi.fn(() => 'already uploaded today') })

    upload.kick('startup')
    await upload.stop()

    expect(job.produce).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      vi.mocked(log.debug).mock.calls.some(([m]) => /already uploaded today/.test(String(m))),
    ).toBe(true)
  })

  it('triggerUpload reports sharing disabled', async () => {
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock
    const { upload } = makeUpload({ isSyncEnabled: () => false })

    expect(await upload.triggerUpload()).toEqual({ success: false, error: 'Sharing disabled' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('triggerUpload reports an unactivated device', async () => {
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock
    const { upload } = makeUpload({ isActivated: () => false })

    expect(await upload.triggerUpload()).toEqual({ success: false, error: 'Device not activated' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('triggerUpload bypasses the skip reason', async () => {
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock
    const { upload, job } = makeUpload({}, { skipReason: vi.fn(() => 'already uploaded today') })

    expect(await upload.triggerUpload()).toEqual({ success: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(job.skipReason).not.toHaveBeenCalled()
  })

  it('triggerUpload surfaces a server failure', async () => {
    globalThis.fetch = mockFetchResponse(500, 'server error')
    const { upload, job } = makeUpload()

    const result = await upload.triggerUpload()

    expect(result.success).toBe(false)
    expect(result.error).toContain('500')
    expect(job.onSuccess).not.toHaveBeenCalled()
  })

  it('removes the temp file after success, after a server failure, and after produce throws', async () => {
    globalThis.fetch = mockFetchResponse(200)
    const ok = makeUpload()
    ok.upload.kick('startup')
    await ok.upload.stop()
    expect(fs.existsSync(ok.job.produce.mock.calls[0][0])).toBe(false)

    globalThis.fetch = mockFetchResponse(500, 'server error')
    const failed = makeUpload()
    failed.upload.kick('startup')
    await failed.upload.stop()
    expect(fs.existsSync(failed.job.produce.mock.calls[0][0])).toBe(false)

    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock
    const broken = makeUpload(
      {},
      {
        produce: vi.fn(async (tempPath: string) => {
          fs.writeFileSync(tempPath, 'partial')
          throw new Error('backup failed')
        }),
      },
    )
    broken.upload.kick('startup')
    await broken.upload.stop()
    expect(fs.existsSync(broken.job.produce.mock.calls[0][0])).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledTimes(2)
  })

  it('uploads on startup and on each interval tick', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock
    const { upload } = makeUpload({ intervalMs: 1000 })

    upload.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await upload.stop()
  })

  it('re-evaluates the sharing gate on each tick', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock
    let syncOn = false
    const { upload } = makeUpload({ intervalMs: 1000, isSyncEnabled: () => syncOn })

    upload.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock).not.toHaveBeenCalled()

    syncOn = true
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await upload.stop()
  })

  it('an in-flight upload completes when the gate flips mid-flight', async () => {
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock
    const gate = deferred()
    let syncOn = true
    const { upload, job } = makeUpload(
      { isSyncEnabled: () => syncOn },
      {
        produce: vi.fn(async () => {
          await gate.promise
          return Buffer.from('payload')
        }),
      },
    )

    upload.kick('startup')
    await vi.waitFor(() => expect(job.produce).toHaveBeenCalledTimes(1))
    syncOn = false
    gate.resolve()
    await upload.stop()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(job.onSuccess).toHaveBeenCalledTimes(1)
  })

  it('coalesces a kick that lands mid-flight and re-gates the rerun', async () => {
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock
    const gate = deferred()
    let uploaded = false
    const { upload, job } = makeUpload(
      {},
      {
        skipReason: vi.fn(() => (uploaded ? 'already uploaded today' : null)),
        produce: vi.fn(async () => {
          await gate.promise
          return Buffer.from('payload')
        }),
        onSuccess: vi.fn(async () => {
          uploaded = true
        }),
      },
    )

    upload.kick('startup')
    await vi.waitFor(() => expect(job.produce).toHaveBeenCalledTimes(1))
    upload.kick('resume')
    gate.resolve()
    await upload.stop()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(job.skipReason).toHaveBeenCalledTimes(2)
  })

  it('skips scheduled uploads while suspended, offline, or unresolved', async () => {
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock
    const host = new ManualHostEnvironment()
    const { upload, job } = makeUpload({ env: host, getBackendUrl: () => 'https://backend.test/' })

    host.suspend()
    upload.kick('interval')
    await upload.stop()

    host.resume()
    host.online = false
    upload.kick('interval')
    await upload.stop()

    host.online = true
    host.resolvable = false
    upload.kick('interval')
    await upload.stop()

    expect(job.produce).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('triggerUpload ignores the suspended, offline and unresolved gates', async () => {
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock
    const host = new ManualHostEnvironment()
    host.suspend()
    host.online = false
    host.resolvable = false
    const { upload } = makeUpload({ env: host, getBackendUrl: () => 'https://backend.test/' })

    expect(await upload.triggerUpload()).toEqual({ success: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('aborts the transfer on suspend and treats it as not attempted', async () => {
    const host = new ManualHostEnvironment()
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    globalThis.fetch = fetchMock
    const { upload, job } = makeUpload({ env: host, getBackendUrl: () => 'https://backend.test/' })

    upload.kick('interval')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(host.suspendListenerCount).toBe(1)

    host.suspend()
    await upload.stop()

    expect(job.onSuccess).not.toHaveBeenCalled()
    expect(log.error).not.toHaveBeenCalled()
    expect(vi.mocked(log.info).mock.calls.some(([m]) => /deferred/.test(String(m)))).toBe(true)
    expect(host.suspendListenerCount).toBe(0)
  })

  it('a network failure with no suspend counts as a failed upload', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND backend.test'), {
          code: 'ENOTFOUND',
        }),
      })
    })
    const { upload, job } = makeUpload({
      env: new ManualHostEnvironment(),
      getBackendUrl: () => 'https://backend.test/',
    })

    upload.kick('interval')
    await upload.stop()

    expect(job.onSuccess).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledTimes(1)
  })

  it('a resume kick runs the upload skipped while suspended', async () => {
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock
    const host = new ManualHostEnvironment()
    const { upload } = makeUpload({ env: host, getBackendUrl: () => 'https://backend.test/' })

    host.suspend()
    upload.kick('interval')
    await upload.stop()
    expect(fetchMock).not.toHaveBeenCalled()

    host.resume()
    upload.kick('resume')
    await upload.stop()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
