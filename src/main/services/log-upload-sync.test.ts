import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { LogUploadSync, type LogUploadSyncParams } from './log-upload-sync'
import type { LogUploadState } from './log-upload-store'

const NOW = 1_700_000_000_000

function mockFetchResponse(status: number, body: object | string = { ok: true }) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === 'object' ? body : JSON.parse(body)),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }))
}

describe('LogUploadSync', () => {
  const originalFetch = globalThis.fetch
  let dir: string
  let logPath: string
  let statsPath: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-upload-sync-test-'))
    logPath = path.join(dir, 'main.log')
    statsPath = path.join(dir, 'summary-mode-stats.json')
    fs.writeFileSync(logPath, 'log line\n')
    fs.writeFileSync(statsPath, '{"total":1}')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function makeSync(overrides: Partial<LogUploadSyncParams> = {}): {
    sync: LogUploadSync
    zipFiles: ReturnType<typeof vi.fn>
    state: { value: LogUploadState | null }
  } {
    const state: { value: LogUploadState | null } = { value: null }
    const zipFiles = vi.fn(async (_files: string[], out: string) => {
      fs.writeFileSync(out, 'zip-bytes')
    })
    const sync = new LogUploadSync({
      getDeviceId: () => 'device-hex-id',
      isActivated: () => true,
      isSyncEnabled: () => true,
      getBackendUrl: () => 'http://localhost:8000/',
      readState: () => state.value,
      writeState: (s) => {
        state.value = s
      },
      collectFiles: () => [logPath, statsPath],
      zipFiles,
      now: () => NOW,
      ...overrides,
    })
    return { sync, zipFiles, state }
  }

  it('uploads a zipped bundle with Bearer auth when activated and changed', async () => {
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { sync, zipFiles, state } = makeSync()
    sync.requestSync('startup')
    await sync.stop()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.toString()).toBe('http://localhost:8000/api/device/logs')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer device-hex-id')
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob)

    // The bundle carries both the log and the diagnostic stats file.
    expect(zipFiles).toHaveBeenCalledTimes(1)
    expect(zipFiles.mock.calls[0][0]).toEqual([logPath, statsPath])

    // Marker advanced on success.
    expect(state.value?.lastUploadAt).toBe(NOW)
    expect(state.value?.lastSig).toBeTruthy()
  })

  it('skips when sharing is disabled', async () => {
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { sync, zipFiles } = makeSync({ isSyncEnabled: () => false })
    sync.requestSync('startup')
    await sync.stop()

    expect(zipFiles).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips when the device is not activated', async () => {
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { sync, zipFiles } = makeSync({ isActivated: () => false })
    sync.requestSync('startup')
    await sync.stop()

    expect(zipFiles).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips a second upload when the logs are unchanged', async () => {
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { sync, zipFiles } = makeSync()
    sync.requestSync('first')
    await sync.stop()
    sync.requestSync('second')
    await sync.stop()

    // Same files → same signature → second pass is a no-op.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(zipFiles).toHaveBeenCalledTimes(1)
  })

  it('throttles a changed bundle within the min interval', async () => {
    const fetchMock = mockFetchResponse(200)
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { sync, zipFiles } = makeSync({ minIntervalMs: 10_000 })
    // A recent upload with a different signature: changed, but throttled.
    sync.requestSync('startup') // first establishes the marker
    await sync.stop()
    fetchMock.mockClear()
    zipFiles.mockClear()

    // Mutate a log so the signature changes, but stay within the interval.
    fs.writeFileSync(logPath, 'log line\nmore\n')
    sync.requestSync('interval')
    await sync.stop()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(zipFiles).not.toHaveBeenCalled()
  })

  it('does not advance the marker when the upload fails', async () => {
    const fetchMock = mockFetchResponse(500, 'server error')
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const { sync, state } = makeSync()
    sync.requestSync('startup')
    await sync.stop()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(state.value).toBeNull()
  })
})
