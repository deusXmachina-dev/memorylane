import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { deviceReportJob } from './device-report-job'
import type { DeviceReportState, KeySource } from './device-report-store'

const EXPECTED_PLATFORM =
  process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : null

function makeJob(
  overrides: Partial<{
    getKeySource: () => KeySource
    readStored: () => DeviceReportState | null
  }> = {},
) {
  const writeStored = vi.fn()
  const job = deviceReportJob({
    getVersion: () => '1.3.0',
    getKeySource: overrides.getKeySource ?? (() => 'byok'),
    edition: 'customer',
    readStored: overrides.readStored ?? (() => null),
    writeStored,
  })
  return { job, writeStored }
}

async function report(job: ReturnType<typeof makeJob>['job']): Promise<unknown> {
  const body = (await job.produce('')) as Blob
  await job.onSuccess({} as Response)
  return JSON.parse(await body.text())
}

describe('deviceReportJob', () => {
  it('reports the version, platform and key source as JSON', async () => {
    const { job, writeStored } = makeJob()

    expect(job.skipReason()).toBeNull()
    const body = (await job.produce('')) as Blob
    expect(body.type).toBe('application/json')
    expect(JSON.parse(await body.text())).toEqual({
      app_version: '1.3.0',
      platform: EXPECTED_PLATFORM,
      key_source: 'byok',
    })
    await job.onSuccess({} as Response)
    expect(writeStored).toHaveBeenCalledWith({ version: '1.3.0', keySource: 'byok' })
  })

  it('skips when the stored marker already matches', () => {
    const { job } = makeJob({ readStored: () => ({ version: '1.3.0', keySource: 'byok' }) })
    expect(job.skipReason()).toBe('already reported')
  })

  it('reports a stored marker without a key source (older build)', () => {
    const { job } = makeJob({ readStored: () => ({ version: '1.3.0', keySource: null }) })
    expect(job.skipReason()).toBeNull()
  })

  it('stays quiet after a report, then re-reports when the key source changes', async () => {
    let keySource: KeySource = 'none'
    const { job, writeStored } = makeJob({ getKeySource: () => keySource })

    await report(job)
    expect(job.skipReason()).toBe('already reported')

    keySource = 'managed'
    expect(job.skipReason()).toBeNull()
    expect(await report(job)).toMatchObject({ key_source: 'managed' })
    expect(writeStored).toHaveBeenLastCalledWith({ version: '1.3.0', keySource: 'managed' })
  })

  it('keeps reporting until a report lands', async () => {
    const { job, writeStored } = makeJob()

    await job.produce('')
    expect(job.skipReason()).toBeNull()
    expect(writeStored).not.toHaveBeenCalled()
  })
})
