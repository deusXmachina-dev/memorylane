import * as fs from 'fs'
import * as zlib from 'zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseUploadSync } from './database-upload-sync'
import log from '@main/utils/logger'
import { ManualHostEnvironment } from '@main/monitoring/host-environment'

// The real prep runs in a utilityProcess (electron) and does SQLite work;
// stub it with an in-process gzip of the backup file so the upload flow stays
// deterministic and produces genuine gzip bytes for the round-trip assertion.
vi.mock('./upload-prep', () => ({
  prepareUploadInWorker: async (tempPath: string) => {
    const fs = await import('fs')
    const zlib = await import('zlib')
    return zlib.gzipSync(fs.readFileSync(tempPath))
  },
}))

function mockFetchResponse(status: number, body: object | string) {
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
    globalThis.fetch = fetchMock

    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => true,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      getBackendUrl: () => 'http://localhost:8000/',
      getLastUploadAt: () => null,
      recordUploadAt: () => {},
    })

    sync.start()
    await vi.advanceTimersByTimeAsync?.(0).catch(() => undefined)
    // Wait for the in-flight promise to settle
    await sync.stop()

    expect(backupToFile).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe('http://localhost:8000/api/device/upload')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer device-hex-id')
    expect((init.body as FormData).has('device_id')).toBe(false)
  })

  it('gzip-compresses the uploaded database', async () => {
    const fetchMock = mockFetchResponse(201, {
      ok: true,
      upload_id: 'up_123',
      checksum_sha256: 'abc',
    })
    globalThis.fetch = fetchMock

    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => true,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      getBackendUrl: () => 'http://localhost:8000/',
      getLastUploadAt: () => null,
      recordUploadAt: () => {},
    })

    sync.start()
    await vi.advanceTimersByTimeAsync?.(0).catch(() => undefined)
    await sync.stop()

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    const part = (init.body as FormData).get('file') as Blob
    expect(part).toBeInstanceOf(Blob)

    const bytes = Buffer.from(await part.arrayBuffer())
    // gzip magic bytes — the server detects compression by these.
    expect(bytes[0]).toBe(0x1f)
    expect(bytes[1]).toBe(0x8b)
    // and it round-trips back to the exact backup content.
    expect(zlib.gunzipSync(bytes).toString()).toBe('dbcontent')
  })

  it('skips upload when not activated', async () => {
    const fetchMock = mockFetchResponse(201, { ok: true })
    globalThis.fetch = fetchMock

    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => false,
      isSyncEnabled: () => true,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      getBackendUrl: () => 'http://localhost:8000/',
      getLastUploadAt: () => null,
      recordUploadAt: () => {},
    })

    sync.start()
    await sync.stop()

    expect(backupToFile).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cleans up temp file on upload failure', async () => {
    const fetchMock = mockFetchResponse(500, 'server error')
    globalThis.fetch = fetchMock

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
      getBackendUrl: () => 'http://localhost:8000/',
      getLastUploadAt: () => null,
      recordUploadAt: () => {},
    })

    sync.start()
    await sync.stop()

    expect(backupToFile).toHaveBeenCalledTimes(1)
    expect(tempFiles.length).toBe(1)
    expect(fs.existsSync(tempFiles[0])).toBe(false)
  })

  it('cleans up temp file on backup failure', async () => {
    const fetchMock = mockFetchResponse(201, { ok: true })
    globalThis.fetch = fetchMock

    const backupToFile = vi.fn(async () => {
      throw new Error('backup failed')
    })

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => true,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      getBackendUrl: () => 'http://localhost:8000/',
      getLastUploadAt: () => null,
      recordUploadAt: () => {},
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
    globalThis.fetch = fetchMock

    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => true,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      getBackendUrl: () => 'http://localhost:8000/',
      getLastUploadAt: () => null,
      recordUploadAt: () => {},
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
    globalThis.fetch = fetchMock

    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => false,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      getBackendUrl: () => 'http://localhost:8000/',
      getLastUploadAt: () => null,
      recordUploadAt: () => {},
    })

    sync.start()
    await sync.stop()

    expect(backupToFile).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('triggerUpload returns error when sync is disabled', async () => {
    const fetchMock = mockFetchResponse(201, { ok: true })
    globalThis.fetch = fetchMock

    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => false,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      getBackendUrl: () => 'http://localhost:8000/',
      getLastUploadAt: () => null,
      recordUploadAt: () => {},
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
    globalThis.fetch = fetchMock

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
      getBackendUrl: () => 'http://localhost:8000/',
      getLastUploadAt: () => null,
      recordUploadAt: () => {},
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

  it('skips startup upload when already uploaded earlier today', async () => {
    const fetchMock = mockFetchResponse(201, { ok: true })
    globalThis.fetch = fetchMock

    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => true,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      getBackendUrl: () => 'http://localhost:8000/',
      // Uploaded a few hours ago (same calendar day) — gate should skip.
      getLastUploadAt: () => Date.now() - 3 * 60 * 60 * 1000,
      recordUploadAt: () => {},
    })

    sync.start()
    await sync.stop()

    expect(backupToFile).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uploads when the last upload was a previous day', async () => {
    const fetchMock = mockFetchResponse(201, {
      ok: true,
      upload_id: 'up_1',
      checksum_sha256: 'abc',
    })
    globalThis.fetch = fetchMock

    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => true,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      getBackendUrl: () => 'http://localhost:8000/',
      // Last upload ~2 days ago — gate should let it through.
      getLastUploadAt: () => Date.now() - 2 * 24 * 60 * 60 * 1000,
      recordUploadAt: () => {},
    })

    sync.start()
    await sync.stop()

    expect(backupToFile).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('records the timestamp only on a successful upload', async () => {
    const fetchMock = mockFetchResponse(500, 'server error')
    globalThis.fetch = fetchMock

    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })
    const recordUploadAt = vi.fn()

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => true,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      getBackendUrl: () => 'http://localhost:8000/',
      getLastUploadAt: () => null,
      recordUploadAt,
    })

    sync.start()
    await sync.stop()

    // Upload failed (HTTP 500) — timestamp must NOT be recorded, so the next
    // wake/startup retries.
    expect(recordUploadAt).not.toHaveBeenCalled()
  })

  it('records the timestamp after a successful upload', async () => {
    const fetchMock = mockFetchResponse(201, {
      ok: true,
      upload_id: 'up_1',
      checksum_sha256: 'abc',
    })
    globalThis.fetch = fetchMock

    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })
    const recordUploadAt = vi.fn()

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => true,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      getBackendUrl: () => 'http://localhost:8000/',
      getLastUploadAt: () => null,
      recordUploadAt,
    })

    sync.start()
    await sync.stop()

    expect(recordUploadAt).toHaveBeenCalledTimes(1)
  })

  it('triggerUpload forces an upload even when already uploaded today', async () => {
    const fetchMock = mockFetchResponse(201, {
      ok: true,
      upload_id: 'up_1',
      checksum_sha256: 'abc',
    })
    globalThis.fetch = fetchMock

    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => true,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      getBackendUrl: () => 'http://localhost:8000/',
      // Already uploaded today — the gate would skip an automatic upload, but
      // a manual trigger must bypass it.
      getLastUploadAt: () => Date.now(),
      recordUploadAt: () => {},
    })

    const result = await sync.triggerUpload()

    expect(result).toEqual({ success: true })
    expect(backupToFile).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('in-flight upload completes even if the gate flips to false mid-flight', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetchResponse(201, {
      ok: true,
      upload_id: 'up_1',
      checksum_sha256: 'abc',
    })
    globalThis.fetch = fetchMock

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
      getBackendUrl: () => 'http://localhost:8000/',
      getLastUploadAt: () => null,
      recordUploadAt: () => {},
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

  it('uploads exactly once per local calendar day across hourly ticks', async () => {
    vi.useFakeTimers()
    // Start late on day 1 so the next hourly tick crosses local midnight.
    vi.setSystemTime(new Date(2026, 5, 24, 23, 0, 0))
    const fetchMock = mockFetchResponse(201, {
      ok: true,
      upload_id: 'up_1',
      checksum_sha256: 'abc',
    })
    globalThis.fetch = fetchMock

    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })
    // Backing store that the gate actually reads/writes, like production.
    let lastUploadAt: number | null = null

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => true,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      getBackendUrl: () => 'http://localhost:8000/',
      getLastUploadAt: () => lastUploadAt,
      recordUploadAt: (ts) => {
        lastUploadAt = ts
      },
      intervalMs: 60 * 60 * 1000,
    })

    sync.start()
    await vi.advanceTimersByTimeAsync(0)
    // Day 1 upload.
    expect(backupToFile).toHaveBeenCalledTimes(1)

    // Tick across midnight into day 2 — uploads again (new calendar day).
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(backupToFile).toHaveBeenCalledTimes(2)

    // Another hour, still day 2 — gated out, no second upload that day.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(backupToFile).toHaveBeenCalledTimes(2)

    await sync.stop()
  })

  it('does not double-upload when a second trigger races before the first records', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetchResponse(201, {
      ok: true,
      upload_id: 'up_1',
      checksum_sha256: 'abc',
    })
    globalThis.fetch = fetchMock

    let resolveBackup!: () => void
    const backupGate = new Promise<void>((resolve) => {
      resolveBackup = resolve
    })
    let firstCall = true
    const backupToFile = vi.fn(async (dest: string) => {
      if (firstCall) {
        firstCall = false
        await backupGate
      }
      fs.writeFileSync(dest, 'dbcontent')
    })
    let lastUploadAt: number | null = null

    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => true,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      getBackendUrl: () => 'http://localhost:8000/',
      getLastUploadAt: () => lastUploadAt,
      recordUploadAt: (ts) => {
        lastUploadAt = ts
      },
      intervalMs: 1_000_000,
    })

    // Startup upload enters uploadOnce (gate passes, store still empty) and
    // blocks on the backup gate.
    sync.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(backupToFile).toHaveBeenCalledTimes(1)

    // A second trigger (e.g. power resume) arrives mid-flight, before the first
    // upload has recorded its timestamp — schedules a coalesced rerun.
    sync.scheduleUploadIfStale('resume')

    // Release the first upload: it records today's timestamp, then the rerun
    // re-checks the daily gate and skips — exactly one upload, not two.
    resolveBackup()
    await sync.stop()

    expect(backupToFile).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  const syncWith = (
    host: ManualHostEnvironment,
    overrides: { recordUploadAt?: (ts: number) => void; intervalMs?: number } = {},
  ) => {
    const backupToFile = vi.fn(async (dest: string) => {
      fs.writeFileSync(dest, 'dbcontent')
    })
    const sync = new DatabaseUploadSync({
      storage: { backupToFile },
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => true,
      getStripOptions: () => ({ detailLevel: 'summary' as const }),
      getBackendUrl: () => 'https://backend.test/',
      getLastUploadAt: () => null,
      recordUploadAt: overrides.recordUploadAt ?? (() => {}),
      intervalMs: overrides.intervalMs,
      env: host,
    })
    return { sync, backupToFile }
  }

  it('skips scheduled uploads while the system is suspended', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetchResponse(201, { ok: true, upload_id: 'up_1', checksum_sha256: 'x' })
    globalThis.fetch = fetchMock
    const host = new ManualHostEnvironment()
    host.suspended = true
    const { sync, backupToFile } = syncWith(host, { intervalMs: 1000 })

    sync.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    await sync.stop()

    expect(backupToFile).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips scheduled uploads while offline', async () => {
    const fetchMock = mockFetchResponse(201, { ok: true, upload_id: 'up_1', checksum_sha256: 'x' })
    globalThis.fetch = fetchMock
    const host = new ManualHostEnvironment()
    host.online = false
    const { sync, backupToFile } = syncWith(host)

    sync.start()
    await sync.stop()

    expect(backupToFile).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a manual trigger ignores the suspended and offline gates', async () => {
    const fetchMock = mockFetchResponse(201, { ok: true, upload_id: 'up_1', checksum_sha256: 'x' })
    globalThis.fetch = fetchMock
    const host = new ManualHostEnvironment()
    host.online = false
    const { sync } = syncWith(host)

    expect(await sync.triggerUpload()).toEqual({ success: true })
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
    const recordUploadAt = vi.fn()
    const errorLog = vi.spyOn(log, 'error').mockImplementation(() => {})
    const infoLog = vi.spyOn(log, 'info').mockImplementation(() => {})
    const { sync, backupToFile } = syncWith(host, { recordUploadAt })

    sync.start()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(host.suspendListeners.size).toBe(1)

    host.suspend()
    await sync.stop()

    expect(backupToFile).toHaveBeenCalledTimes(1)
    expect(recordUploadAt).not.toHaveBeenCalled()
    expect(errorLog).not.toHaveBeenCalled()
    expect(infoLog.mock.calls.some(([msg]) => /deferred/.test(String(msg)))).toBe(true)
    expect(host.suspendListeners.size).toBe(0)
    errorLog.mockRestore()
    infoLog.mockRestore()
  })

  it('a network failure with no suspend still counts as a failed upload', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND backend.test'), {
          code: 'ENOTFOUND',
        }),
      })
    })
    const errorLog = vi.spyOn(log, 'error').mockImplementation(() => {})
    const { sync } = syncWith(new ManualHostEnvironment())

    sync.start()
    await sync.stop()

    expect(errorLog).toHaveBeenCalledTimes(1)
    errorLog.mockRestore()
  })

  it('a resume kick runs the upload skipped while suspended', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetchResponse(201, { ok: true, upload_id: 'up_1', checksum_sha256: 'x' })
    globalThis.fetch = fetchMock
    const host = new ManualHostEnvironment()
    host.suspended = true
    const { sync, backupToFile } = syncWith(host, { intervalMs: 1000 })

    sync.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(backupToFile).not.toHaveBeenCalled()

    host.suspended = false
    sync.scheduleUploadIfStale('resume')
    await vi.advanceTimersByTimeAsync(0)
    await sync.stop()

    expect(backupToFile).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
