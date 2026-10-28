import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  databaseUploadJob,
  DELTA_OVERLAP_MS,
  type DatabaseUploadJobParams,
  type PrepareUpload,
} from './database-upload-job'
import type { BackendRequest } from './backend-client'
import { jsonResponse, readFormFile } from '@main/utils/test-utils'

const HOUR = 60 * 60 * 1000

function makeJob(overrides: Partial<DatabaseUploadJobParams> & { syncState?: object } = {}) {
  const { syncState = { last_end_ts: null }, ...params } = overrides
  const request = vi.fn(async (_path: string, init: BackendRequest) =>
    init.method === 'DELETE' ? jsonResponse({}, true, 204) : jsonResponse(syncState),
  )
  const prepareUpload = vi.fn<PrepareUpload>(async () => Buffer.from('gz'))
  const backupToFile = vi.fn(async () => {})
  const recordUploadAt = vi.fn()
  const clearResetRequest = vi.fn()
  const job = databaseUploadJob({
    backend: { request },
    getDbPath: () => '/db/memorylane.db',
    backupToFile,
    getLastUploadAt: () => null,
    recordUploadAt,
    getResetRequestedAt: () => null,
    clearResetRequest,
    prepareUpload,
    ...params,
  })
  return { job, request, prepareUpload, backupToFile, recordUploadAt, clearResetRequest }
}

const created = jsonResponse({}, true, 201)

describe('databaseUploadJob', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is due when never uploaded or last uploaded on a previous day', () => {
    expect(makeJob().job.skipReason()).toBeNull()
    expect(makeJob({ getLastUploadAt: () => Date.now() - 48 * HOUR }).job.skipReason()).toBeNull()
  })

  it('gates once per local calendar day, not per 24 hours', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 24, 23, 0, 0))
    let lastUploadAt: number | null = null
    const { job } = makeJob({ getLastUploadAt: () => lastUploadAt })

    expect(job.skipReason()).toBeNull()
    lastUploadAt = Date.now()
    vi.setSystemTime(new Date(2026, 5, 24, 23, 30, 0))
    expect(job.skipReason()).toBe('already uploaded today')
    vi.setSystemTime(new Date(2026, 5, 25, 0, 30, 0))
    expect(job.skipReason()).toBeNull()
  })

  it('uploads the whole database when the state endpoint is missing or sync is off', async () => {
    for (const status of [404, 409]) {
      const { job, prepareUpload, backupToFile } = makeJob({
        backend: { request: async () => jsonResponse({}, false, status) },
      })

      const body = await job.produce('/tmp/out')

      expect(job.endpoint).toBe('api/device/upload')
      expect(backupToFile).toHaveBeenCalledWith('/tmp/out')
      expect(prepareUpload).toHaveBeenCalledWith({ kind: 'snapshot', path: '/tmp/out' })
      expect((body as FormData).has('format')).toBe(false)
      expect((await readFormFile(body)).name).toBe('memorylane.db.gz')
    }
  })

  it('falls back to a snapshot when the delta is rejected with 404 or 409', async () => {
    for (const status of [404, 409]) {
      const { job, prepareUpload } = makeJob()
      await job.produce('/tmp/out')

      const body = await job.fallback!(jsonResponse({}, false, status), '/tmp/out')

      expect(body).not.toBeNull()
      expect(job.endpoint).toBe('api/device/upload')
      expect(prepareUpload.mock.calls[1][0]).toEqual({ kind: 'snapshot', path: '/tmp/out' })
    }
  })

  it('does not fall back on other delta failures or after a snapshot', async () => {
    const delta = makeJob()
    await delta.job.produce('/tmp/out')
    expect(await delta.job.fallback!(jsonResponse({}, false, 500), '/tmp/out')).toBeNull()

    const snap = makeJob({ backend: { request: async () => jsonResponse({}, false, 409) } })
    await snap.job.produce('/tmp/out')
    expect(await snap.job.fallback!(jsonResponse({}, false, 404), '/tmp/out')).toBeNull()
  })

  it('sends a delta starting one overlap window before the server cursor', async () => {
    const { job, request, prepareUpload } = makeJob({
      syncState: { last_end_ts: 10 * HOUR },
    })

    const body = await job.produce('/tmp/out')

    expect(request).toHaveBeenCalledWith('api/device/data/state', expect.anything())
    expect(prepareUpload).toHaveBeenCalledWith({
      kind: 'delta',
      dbPath: '/db/memorylane.db',
      outPath: '/tmp/out',
      sinceTs: 10 * HOUR - DELTA_OVERLAP_MS,
    })
    expect((body as FormData).get('format')).toBe('delta-v1')
    expect((await readFormFile(body)).name).toBe('delta.db.gz')
  })

  it('sends everything when the server has no activities yet', async () => {
    const { job, prepareUpload } = makeJob()

    await job.produce('/tmp/out')

    const req = prepareUpload.mock.calls[0][0]
    expect(req.kind === 'delta' && req.sinceTs).toBe(0)
  })

  it('fails when the sync state request fails', async () => {
    const { job } = makeJob({ backend: { request: async () => jsonResponse({}, false, 500) } })

    await expect(job.produce('/tmp/out')).rejects.toThrow('Sync state failed (500)')
  })

  it('records the upload day on success', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const { job, recordUploadAt } = makeJob()

    await job.produce('/tmp/out')
    await job.onSuccess(created)

    expect(recordUploadAt).toHaveBeenCalledWith(1_700_000_000_000)
  })

  it('rejects a delta upload that is not answered with 201', async () => {
    const { job, recordUploadAt } = makeJob()

    await job.produce('/tmp/out')

    await expect(job.onSuccess(jsonResponse({}))).rejects.toThrow('expected 201')
    expect(recordUploadAt).not.toHaveBeenCalled()
  })

  it('deletes the server copy before uploading after a purge or import', async () => {
    const { job, request, clearResetRequest } = makeJob({ getResetRequestedAt: () => 5 })

    await job.produce('/tmp/out')

    expect(request.mock.calls[0]).toEqual([
      'api/device/data',
      expect.objectContaining({ method: 'DELETE' }),
    ])
    expect(request.mock.calls[1][0]).toBe('api/device/data/state')
    expect(clearResetRequest).toHaveBeenCalled()
  })

  it('does not delete when no reset is pending', async () => {
    const { job, request } = makeJob()

    await job.produce('/tmp/out')

    expect(request.mock.calls.some(([, init]) => init.method === 'DELETE')).toBe(false)
  })

  it('treats a 404 on delete as done', async () => {
    const clearResetRequest = vi.fn()
    const { job } = makeJob({
      backend: { request: async () => jsonResponse({}, false, 404) },
      getResetRequestedAt: () => 5,
      clearResetRequest,
    })

    await job.produce('/tmp/out')

    expect(clearResetRequest).toHaveBeenCalled()
  })

  it('keeps the reset and stops when the delete fails', async () => {
    const { job, prepareUpload, clearResetRequest } = makeJob({
      backend: { request: async () => jsonResponse({}, false, 500) },
      getResetRequestedAt: () => 5,
    })

    await expect(job.produce('/tmp/out')).rejects.toThrow('Data reset failed (500)')
    expect(clearResetRequest).not.toHaveBeenCalled()
    expect(prepareUpload).not.toHaveBeenCalled()
  })

  it('keeps a reset requested while the delete was in flight', async () => {
    let resetAt = 5
    const { job, clearResetRequest } = makeJob({
      backend: {
        request: async (_path: string, init: BackendRequest) => {
          if (init.method === 'DELETE') resetAt = 6
          return jsonResponse({ last_end_ts: null })
        },
      },
      getResetRequestedAt: () => resetAt,
    })

    await job.produce('/tmp/out')

    expect(clearResetRequest).not.toHaveBeenCalled()
  })
})
