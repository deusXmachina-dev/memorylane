import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as zlib from 'zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('./upload-prep', () => ({
  prepareUploadInWorker: async (tempPath: string) => {
    const fs = await import('fs')
    const zlib = await import('zlib')
    return zlib.gzipSync(fs.readFileSync(tempPath))
  },
}))

import { databaseUploadJob, type DatabaseUploadJobParams } from './database-upload-job'

const HOUR = 60 * 60 * 1000

function makeJob(overrides: Partial<DatabaseUploadJobParams> = {}) {
  const backupToFile = vi.fn(async (dest: string) => {
    fs.writeFileSync(dest, 'dbcontent')
  })
  const recordUploadAt = vi.fn()
  const job = databaseUploadJob({
    storage: { backupToFile },
    getStripOptions: () => ({ detailLevel: 'summary' }),
    getLastUploadAt: () => null,
    recordUploadAt,
    ...overrides,
  })
  return { job, backupToFile, recordUploadAt }
}

describe('databaseUploadJob', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is due when never uploaded or last uploaded on a previous day', () => {
    expect(makeJob().job.skipReason()).toBeNull()
    expect(makeJob({ getLastUploadAt: () => Date.now() - 48 * HOUR }).job.skipReason()).toBeNull()
  })

  it('skips when already uploaded today', () => {
    const { job } = makeJob({ getLastUploadAt: () => Date.now() - 3 * HOUR })
    expect(job.skipReason()).toBe('already uploaded today')
  })

  it('gates once per local calendar day, not per 24 hours', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 24, 23, 0, 0))
    let lastUploadAt: number | null = null
    const { job } = makeJob({
      getLastUploadAt: () => lastUploadAt,
      recordUploadAt: (ts) => {
        lastUploadAt = ts
      },
    })

    expect(job.skipReason()).toBeNull()
    lastUploadAt = Date.now()
    vi.setSystemTime(new Date(2026, 5, 24, 23, 30, 0))
    expect(job.skipReason()).toBe('already uploaded today')
    vi.setSystemTime(new Date(2026, 5, 25, 0, 30, 0))
    expect(job.skipReason()).toBeNull()
  })

  it('produces a gzipped backup of the database', async () => {
    const { job, backupToFile } = makeJob()
    const tempPath = path.join(os.tmpdir(), `db-upload-job-test-${process.pid}.tmp`)

    const bytes = await job.produce(tempPath)
    fs.rmSync(tempPath, { force: true })

    expect(backupToFile).toHaveBeenCalledWith(tempPath)
    expect(bytes[0]).toBe(0x1f)
    expect(bytes[1]).toBe(0x8b)
    expect(zlib.gunzipSync(bytes).toString()).toBe('dbcontent')
  })

  it('records the upload timestamp on success', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    const { job, recordUploadAt } = makeJob()

    await job.onSuccess({
      json: async () => ({ ok: true, upload_id: 'u1', checksum_sha256: 'abc' }),
    } as Response)

    expect(recordUploadAt).toHaveBeenCalledWith(1_700_000_000_000)
  })
})
