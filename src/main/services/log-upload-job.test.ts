import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logUploadJob, type LogUploadJobParams } from './log-upload-job'
import type { LogUploadState } from './log-upload-store'

const NOW = 1_700_000_000_000

describe('logUploadJob', () => {
  let dir: string
  let logPath: string
  let statsPath: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-upload-job-test-'))
    logPath = path.join(dir, 'main.log')
    statsPath = path.join(dir, 'summary-mode-stats.json')
    fs.writeFileSync(logPath, 'log line\n')
    fs.writeFileSync(statsPath, '{"total":1}')
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  function makeJob(overrides: Partial<LogUploadJobParams> = {}) {
    const state: { value: LogUploadState | null } = { value: null }
    const zipFiles = vi.fn(async (_files: string[], out: string) => {
      fs.writeFileSync(out, 'zip-bytes')
    })
    const job = logUploadJob({
      readState: () => state.value,
      writeState: (s) => {
        state.value = s
      },
      collectFiles: () => [logPath, statsPath],
      zipFiles,
      minIntervalMs: 10_000,
      now: () => NOW,
      ...overrides,
    })
    return { job, zipFiles, state }
  }

  async function uploadOnce(job: ReturnType<typeof makeJob>['job']) {
    const tempPath = path.join(dir, 'bundle.zip')
    const bytes = await job.produce(tempPath)
    await job.onSuccess({} as Response)
    return bytes
  }

  it('is due on the first run', () => {
    expect(makeJob().job.skipReason()).toBeNull()
  })

  it('skips when there are no log files', () => {
    expect(makeJob({ collectFiles: () => [] }).job.skipReason()).toBe('no log files')
  })

  it('skips when the logs are unchanged since the last upload', async () => {
    const { job } = makeJob()
    await uploadOnce(job)
    expect(job.skipReason()).toBe('logs unchanged since last upload')
  })

  it('throttles a changed bundle within the min interval', async () => {
    const { job } = makeJob()
    await uploadOnce(job)
    fs.writeFileSync(logPath, 'log line\nmore\n')
    expect(job.skipReason()).toBe('throttled (uploaded recently)')
  })

  it('is due once the bundle changed and the interval elapsed', async () => {
    let now = NOW
    const { job } = makeJob({ now: () => now })
    await uploadOnce(job)
    fs.writeFileSync(logPath, 'log line\nmore\n')
    now += 10_000
    expect(job.skipReason()).toBeNull()
  })

  it('zips the collected files and returns the bytes', async () => {
    const { job, zipFiles } = makeJob()
    const tempPath = path.join(dir, 'bundle.zip')

    const bytes = await job.produce(tempPath)

    expect(zipFiles).toHaveBeenCalledWith([logPath, statsPath], tempPath)
    expect(bytes.toString()).toBe('zip-bytes')
  })

  it('produce throws when there are no log files', async () => {
    const { job } = makeJob({ collectFiles: () => [] })
    await expect(job.produce(path.join(dir, 'bundle.zip'))).rejects.toThrow('No log files found')
  })

  it('records the timestamp and the signature of the zipped bundle', async () => {
    const { job, state } = makeJob()
    await uploadOnce(job)

    expect(state.value?.lastUploadAt).toBe(NOW)
    expect(state.value?.lastSig).toMatch(/main\.log:\d+:\d+\|summary-mode-stats\.json:\d+:\d+/)
  })
})
