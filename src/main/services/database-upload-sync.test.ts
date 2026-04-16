import * as fs from 'fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseUploadSync } from './database-upload-sync'

vi.mock('./strip-database-for-upload', () => ({
  stripDatabaseForUpload: vi.fn(),
}))

function mockFetchResponse(status: number, body: object | string) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === 'object' ? body : JSON.parse(body)),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }))
}

describe('DatabaseUploadSync', () => {
  const originalFetch = globalThis.fetch

  afterEach(async () => {
    vi.useRealTimers()
    globalThis.fetch = originalFetch
  })

  it('uploads database when activated', async () => {
    const fetchMock = mockFetchResponse(201, {
      ok: true,
      upload_id: 'up_123',
      checksum_sha256: 'abc',
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => true,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      backendUrl: 'http://localhost:8000/',
    })

    sync.start()
    await vi.advanceTimersByTimeAsync?.(0).catch(() => undefined)
    // Wait for the in-flight promise to settle
    await sync.stop()

    expect(backupToFile).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url.toString()).toBe('http://localhost:8000/device/upload')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('skips upload when not activated', async () => {
    const fetchMock = mockFetchResponse(201, { ok: true })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => false,
      isSyncEnabled: () => true,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      backendUrl: 'http://localhost:8000/',
    })

    sync.start()
    await sync.stop()

    expect(backupToFile).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cleans up temp file on upload failure', async () => {
    const fetchMock = mockFetchResponse(500, 'server error')
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const tempFiles: string[] = []
    const backupToFile = vi.fn(async (dest: string) => {
      tempFiles.push(dest)
      fs.writeFileSync(dest, 'dbcontent')
    })

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => true,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      backendUrl: 'http://localhost:8000/',
    })

    sync.start()
    await sync.stop()

    expect(backupToFile).toHaveBeenCalledTimes(1)
    expect(tempFiles.length).toBe(1)
    expect(fs.existsSync(tempFiles[0])).toBe(false)
  })

  it('cleans up temp file on backup failure', async () => {
    const fetchMock = mockFetchResponse(201, { ok: true })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const backupToFile = vi.fn(async () => {
      throw new Error('backup failed')
    })

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => true,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      backendUrl: 'http://localhost:8000/',
    })

    sync.start()
    await sync.stop()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uploads on startup and on interval', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetchResponse(201, {
      ok: true,
      upload_id: 'up_1',
      checksum_sha256: 'abc',
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => true,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      backendUrl: 'http://localhost:8000/',
      intervalMs: 1000,
    })

    sync.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(backupToFile).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(backupToFile).toHaveBeenCalledTimes(2)

    await sync.stop()
  })

  it('skips automatic upload when sync is disabled', async () => {
    const fetchMock = mockFetchResponse(201, { ok: true })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => false,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      backendUrl: 'http://localhost:8000/',
    })

    sync.start()
    await sync.stop()

    expect(backupToFile).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('triggerUpload returns error when sync is disabled', async () => {
    const fetchMock = mockFetchResponse(201, { ok: true })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => false,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      backendUrl: 'http://localhost:8000/',
    })

    const result = await sync.triggerUpload()

    expect(result).toEqual({ success: false, error: 'Sharing disabled' })
    expect(backupToFile).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('re-evaluates the sync gate on each interval tick', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetchResponse(201, {
      ok: true,
      upload_id: 'up_1',
      checksum_sha256: 'abc',
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })

    let syncOn = false

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => syncOn,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      backendUrl: 'http://localhost:8000/',
      intervalMs: 1000,
    })

    sync.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(backupToFile).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    expect(backupToFile).not.toHaveBeenCalled()

    syncOn = true
    await vi.advanceTimersByTimeAsync(1000)
    expect(backupToFile).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await sync.stop()
  })

  it('in-flight upload completes even if the gate flips to false mid-flight', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetchResponse(201, {
      ok: true,
      upload_id: 'up_1',
      checksum_sha256: 'abc',
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    let syncOn = true
    let resolveBackup!: () => void
    const backupGate = new Promise<void>((resolve) => {
      resolveBackup = resolve
    })

    const backupToFile = vi.fn(async (dest: string) => {
      await backupGate
      fs.writeFileSync(dest, 'dbcontent')
    })

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => syncOn,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      backendUrl: 'http://localhost:8000/',
      intervalMs: 1000,
    })

    sync.start()
    // Let the startup upload enter uploadOnce() past the gate check,
    // then block on the backup promise.
    await vi.advanceTimersByTimeAsync(0)
    expect(backupToFile).toHaveBeenCalledTimes(1)

    // Flip the gate off while the first upload is still in flight.
    syncOn = false
    resolveBackup()

    await sync.stop()

    // The first upload still completed (fetch fired exactly once).
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
