import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  databaseUploadJob,
  SLICE_OVERLAP_MS,
  type DatabaseUploadJobParams,
  type PrepareUpload,
} from './database-upload-job'
import { jsonResponse, readFormFile } from '@main/utils/test-utils'

const HOUR = 60 * 60 * 1000

function makeJob(overrides: Partial<DatabaseUploadJobParams> & { syncState?: object } = {}) {
  const { syncState = { format: 'delta-v1', last_end_ts: null }, ...params } = overrides
  const request = vi.fn(async () => jsonResponse(syncState))
  const prepareUpload = vi.fn<PrepareUpload>(async () => Buffer.from('gz'))
  const backupToFile = vi.fn(async () => {})
  const recordUploadAt = vi.fn()
  const job = databaseUploadJob({
    backend: { request },
    getDbPath: () => '/db/memorylane.db',
    backupToFile,
    getLastUploadAt: () => null,
    recordUploadAt,
    prepareUpload,
    ...params,
  })
  return { job, request, prepareUpload, backupToFile, recordUploadAt }
}

const ok = jsonResponse({})

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

  it('uploads the whole database when the backend asks for a snapshot', async () => {
    const { job, prepareUpload, backupToFile } = makeJob({ syncState: { format: 'snapshot' } })

    const body = await job.produce('/tmp/out')

    expect(backupToFile).toHaveBeenCalledWith('/tmp/out')
    expect(prepareUpload).toHaveBeenCalledWith({ kind: 'snapshot', path: '/tmp/out' })
    expect((body as FormData).has('format')).toBe(false)
    expect((await readFormFile(body)).name).toBe('memorylane.db.gz')
  })

  it('falls back to a snapshot when the backend has no sync-state endpoint', async () => {
    const { job, prepareUpload } = makeJob({
      backend: { request: async () => jsonResponse({}, false, 404) },
    })

    await job.produce('/tmp/out')

    expect(prepareUpload.mock.calls[0][0].kind).toBe('snapshot')
  })

  it('sends a delta slice starting one overlap window before the server cursor', async () => {
    const { job, request, prepareUpload } = makeJob({
      syncState: { format: 'delta-v1', last_end_ts: 10 * HOUR },
    })

    const body = await job.produce('/tmp/out')

    expect(request).toHaveBeenCalledWith('api/device/sync-state', expect.anything())
    expect(prepareUpload).toHaveBeenCalledWith({
      kind: 'slice',
      dbPath: '/db/memorylane.db',
      outPath: '/tmp/out',
      sinceTs: 10 * HOUR - SLICE_OVERLAP_MS,
    })
    expect((body as FormData).get('format')).toBe('delta-v1')
    expect((await readFormFile(body)).name).toBe('slice.db.gz')
  })

  it('sends everything when the server has no activities yet', async () => {
    const { job, prepareUpload } = makeJob()

    await job.produce('/tmp/out')

    const req = prepareUpload.mock.calls[0][0]
    expect(req.kind === 'slice' && req.sinceTs).toBe(0)
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
    await job.onSuccess(ok)

    expect(recordUploadAt).toHaveBeenCalledWith(1_700_000_000_000)
  })
})
