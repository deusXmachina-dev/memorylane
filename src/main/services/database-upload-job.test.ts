import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  databaseUploadJob,
  SLICE_OVERLAP_MS,
  SLICE_PAGE_SIZE,
  type DatabaseUploadJobParams,
  type PrepareUpload,
} from './database-upload-job'
import { jsonResponse, readFormFile } from '@main/utils/test-utils'

const HOUR = 60 * 60 * 1000

function makeJob(
  overrides: Partial<DatabaseUploadJobParams> & {
    syncState?: object
    count?: number
  } = {},
) {
  const { syncState = { format: 'delta-v1', last_end_ts: null }, count = 3, ...params } = overrides
  const request = vi.fn(async () => jsonResponse(syncState))
  const prepareUpload = vi.fn<PrepareUpload>(async () => ({ gzip: Buffer.from('gz'), count }))
  const backupToFile = vi.fn(async () => {})
  const recordSnapshotAt = vi.fn()
  const job = databaseUploadJob({
    backend: { request },
    getDbPath: () => '/db/memorylane.db',
    backupToFile,
    hasActivitiesEndedAfter: () => true,
    getLastSnapshotAt: () => null,
    recordSnapshotAt,
    prepareUpload,
    ...params,
  })
  return { job, request, prepareUpload, backupToFile, recordSnapshotAt }
}

const delta = (lastEndTs: number | null) => ({ format: 'delta-v1', last_end_ts: lastEndTs })
const ok = jsonResponse({})

function sliceRequest(prepareUpload: ReturnType<typeof makeJob>['prepareUpload']) {
  const req = prepareUpload.mock.calls[0][0]
  if (req.kind !== 'slice') throw new Error('expected a slice')
  return req
}

describe('databaseUploadJob', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('snapshot format', () => {
    it('uploads the whole database once a day', async () => {
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

    it('skips when already uploaded today unless forced', async () => {
      const { job, backupToFile } = makeJob({
        syncState: { format: 'snapshot' },
        getLastSnapshotAt: () => Date.now(),
      })

      expect(await job.produce('/tmp/out')).toBeNull()
      expect(backupToFile).not.toHaveBeenCalled()
      expect(await job.produce('/tmp/out', true)).not.toBeNull()
    })
  })

  describe('delta format', () => {
    it('sends everything with the snapshot tables when the server has nothing', async () => {
      const { job, request, prepareUpload } = makeJob()

      const body = await job.produce('/tmp/out')

      expect(request).toHaveBeenCalledWith('api/device/sync-state', expect.anything())
      expect(prepareUpload).toHaveBeenCalledWith({
        kind: 'slice',
        dbPath: '/db/memorylane.db',
        outPath: '/tmp/out',
        sinceTs: 0,
        pageSize: SLICE_PAGE_SIZE,
        includeSnapshot: true,
      })
      expect((body as FormData).get('format')).toBe('delta-v1')
      expect((await readFormFile(body)).name).toBe('slice.db.gz')
    })

    it('starts the slice one overlap window before the server cursor', async () => {
      const { job, prepareUpload } = makeJob({ syncState: delta(10 * HOUR) })

      await job.produce('/tmp/out')

      expect(sliceRequest(prepareUpload).sinceTs).toBe(10 * HOUR - SLICE_OVERLAP_MS)
    })

    it('sends nothing when no activity is newer and the snapshot tables went out today', async () => {
      const hasActivitiesEndedAfter = vi.fn(() => false)
      const { job, prepareUpload } = makeJob({
        syncState: delta(5),
        hasActivitiesEndedAfter,
        getLastSnapshotAt: () => Date.now(),
      })

      expect(await job.produce('/tmp/out')).toBeNull()
      expect(hasActivitiesEndedAfter).toHaveBeenCalledWith(5)
      expect(prepareUpload).not.toHaveBeenCalled()
    })

    it('sends new activities without the snapshot tables once they went out today', async () => {
      const { job, prepareUpload } = makeJob({
        syncState: delta(5),
        getLastSnapshotAt: () => Date.now(),
      })

      await job.produce('/tmp/out')

      expect(sliceRequest(prepareUpload).includeSnapshot).toBe(false)
    })

    it('includes the snapshot tables on a new day or when forced', async () => {
      const newDay = makeJob({
        syncState: delta(5),
        hasActivitiesEndedAfter: () => false,
        getLastSnapshotAt: () => Date.now() - 48 * HOUR,
      })
      await newDay.job.produce('/tmp/out')
      expect(sliceRequest(newDay.prepareUpload).includeSnapshot).toBe(true)

      const forced = makeJob({ syncState: delta(5), getLastSnapshotAt: () => Date.now() })
      await forced.job.produce('/tmp/out', true)
      expect(sliceRequest(forced.prepareUpload).includeSnapshot).toBe(true)
    })

    it('asks for another page only when the slice was full', async () => {
      const full = makeJob({ count: SLICE_PAGE_SIZE })
      await full.job.produce('/tmp/out')
      expect(await full.job.onSuccess(ok)).toBe(true)

      const partial = makeJob({ count: 10 })
      await partial.job.produce('/tmp/out')
      expect(await partial.job.onSuccess(ok)).toBe(false)
    })
  })

  it('fails when the sync state request fails', async () => {
    const { job } = makeJob({ backend: { request: async () => jsonResponse({}, false, 500) } })

    await expect(job.produce('/tmp/out')).rejects.toThrow('Sync state failed (500)')
  })

  it('records only uploads that carried the snapshot', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const withSnapshot = makeJob()
    await withSnapshot.job.produce('/tmp/out')
    await withSnapshot.job.onSuccess(ok)
    expect(withSnapshot.recordSnapshotAt).toHaveBeenCalledWith(1_700_000_000_000)

    const withoutSnapshot = makeJob({ syncState: delta(5), getLastSnapshotAt: () => Date.now() })
    await withoutSnapshot.job.produce('/tmp/out')
    await withoutSnapshot.job.onSuccess(ok)
    expect(withoutSnapshot.recordSnapshotAt).not.toHaveBeenCalled()
  })
})
