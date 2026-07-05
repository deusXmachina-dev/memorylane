import { describe, it, expect, vi } from 'vitest'
import { runTaskBackfillIfNeeded } from './backfill-bootstrap'
import type { BackfillSummary } from './types'
import type { TaskMiner } from '.'
import type { InferenceProvider } from '@main/llm'
import type { CaptureSettingsManager } from '@main/settings/capture-settings-manager'
import type { CaptureSettings } from '../../../shared/types'
import { TASK_BACKFILL } from '../../../shared/constants'

type Settings = Pick<CaptureSettingsManager, 'get' | 'save'>

const makeSettings = (taskBackfillVersion?: number) => {
  const state: Partial<CaptureSettings> = { taskBackfillVersion }
  const save = vi.fn((partial: Partial<CaptureSettings>) => Object.assign(state, partial))
  const get = vi.fn(() => state as CaptureSettings)
  return { get, save } as unknown as Settings & { save: typeof save }
}

const makeProvider = (configured: boolean) =>
  ({ isConfigured: () => configured }) as unknown as InferenceProvider

const makeMiner = (result: BackfillSummary | Error) => {
  const backfill = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  )
  return { taskMiner: { backfill } as unknown as TaskMiner, backfill }
}

const okSummary: BackfillSummary = { daysMined: 5, daysSkipped: 25, daysFailed: 0 }

describe('runTaskBackfillIfNeeded', () => {
  it('skips entirely when already at the current backfill version', async () => {
    const settings = makeSettings(TASK_BACKFILL.VERSION)
    const { taskMiner, backfill } = makeMiner(okSummary)
    await runTaskBackfillIfNeeded({ taskMiner, provider: makeProvider(true), settings, delayMs: 0 })
    expect(backfill).not.toHaveBeenCalled()
    expect(settings.save).not.toHaveBeenCalled()
  })

  it('defers without stamping when no provider is configured', async () => {
    const settings = makeSettings(0)
    const { taskMiner, backfill } = makeMiner(okSummary)
    await runTaskBackfillIfNeeded({
      taskMiner,
      provider: makeProvider(false),
      settings,
      delayMs: 0,
    })
    expect(backfill).not.toHaveBeenCalled()
    expect(settings.save).not.toHaveBeenCalled()
  })

  it('runs the backfill and stamps the version on success', async () => {
    const settings = makeSettings(0)
    const { taskMiner, backfill } = makeMiner(okSummary)
    await runTaskBackfillIfNeeded({ taskMiner, provider: makeProvider(true), settings, delayMs: 0 })
    expect(backfill).toHaveBeenCalledOnce()
    expect(settings.save).toHaveBeenCalledWith({ taskBackfillVersion: TASK_BACKFILL.VERSION })
  })

  it('does not stamp when the backfill reports it was skipped (busy)', async () => {
    const settings = makeSettings(0)
    const { taskMiner } = makeMiner({
      daysMined: 0,
      daysSkipped: 0,
      daysFailed: 0,
      skipped: 'busy',
    })
    await runTaskBackfillIfNeeded({ taskMiner, provider: makeProvider(true), settings, delayMs: 0 })
    expect(settings.save).not.toHaveBeenCalled()
  })

  it('does not stamp when the backfill throws (retries next launch)', async () => {
    const settings = makeSettings(0)
    const { taskMiner } = makeMiner(new Error('boom'))
    await runTaskBackfillIfNeeded({ taskMiner, provider: makeProvider(true), settings, delayMs: 0 })
    expect(settings.save).not.toHaveBeenCalled()
  })
})
