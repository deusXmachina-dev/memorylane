import { describe, it, expect, vi } from 'vitest'
import { runTaskBackfillIfNeeded } from './backfill-bootstrap'
import type { BackfillSummary } from './types'
import type { TaskMiner } from '.'
import type { StorageService } from '../../storage'
import type { InferenceProvider } from '@main/llm'

// hasMined = the DB already has a recorded mining run (mining_runs non-empty).
const makeStorage = (hasMined: boolean) =>
  ({
    miningRuns: { getLastRunTimestamp: () => (hasMined ? 123 : null) },
  }) as unknown as StorageService

const makeProvider = (configured: boolean) =>
  ({ isConfigured: () => configured }) as unknown as InferenceProvider

const makeMiner = (result: BackfillSummary | Error) => {
  const backfill = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  )
  const setBackfillPending = vi.fn()
  return {
    taskMiner: { backfill, setBackfillPending } as unknown as TaskMiner,
    backfill,
    setBackfillPending,
  }
}

const okSummary: BackfillSummary = { daysMined: 5, daysSkipped: 25, daysFailed: 0 }

describe('runTaskBackfillIfNeeded', () => {
  it('skips entirely when the DB has already been mined', async () => {
    const { taskMiner, backfill, setBackfillPending } = makeMiner(okSummary)
    await runTaskBackfillIfNeeded({
      taskMiner,
      provider: makeProvider(true),
      storage: makeStorage(true),
      delayMs: 0,
    })
    expect(backfill).not.toHaveBeenCalled()
    expect(setBackfillPending).not.toHaveBeenCalled()
  })

  it('defers (without claiming priority) when no provider is configured', async () => {
    const { taskMiner, backfill, setBackfillPending } = makeMiner(okSummary)
    await runTaskBackfillIfNeeded({
      taskMiner,
      provider: makeProvider(false),
      storage: makeStorage(false),
      delayMs: 0,
    })
    expect(backfill).not.toHaveBeenCalled()
    expect(setBackfillPending).not.toHaveBeenCalled()
  })

  it('runs the backfill on a fresh (never-mined) DB', async () => {
    const { taskMiner, backfill } = makeMiner(okSummary)
    await runTaskBackfillIfNeeded({
      taskMiner,
      provider: makeProvider(true),
      storage: makeStorage(false),
      delayMs: 0,
    })
    expect(backfill).toHaveBeenCalledOnce()
  })

  it('claims priority up front and releases it once the backfill settles', async () => {
    const { taskMiner, setBackfillPending } = makeMiner(okSummary)
    await runTaskBackfillIfNeeded({
      taskMiner,
      provider: makeProvider(true),
      storage: makeStorage(false),
      delayMs: 0,
    })
    expect(setBackfillPending).toHaveBeenNthCalledWith(1, true)
    expect(setBackfillPending).toHaveBeenLastCalledWith(false)
  })

  it('claims priority synchronously, before awaiting the settle delay', () => {
    const { taskMiner, setBackfillPending } = makeMiner(okSummary)
    // Do not await — the pending claim must be visible before capture resume
    // arms the scheduled run (i.e. before the first await).
    void runTaskBackfillIfNeeded({
      taskMiner,
      provider: makeProvider(true),
      storage: makeStorage(false),
      delayMs: 50,
    })
    expect(setBackfillPending).toHaveBeenCalledWith(true)
  })

  it('releases priority when the backfill reports skipped (busy)', async () => {
    const { taskMiner, setBackfillPending } = makeMiner({
      daysMined: 0,
      daysSkipped: 0,
      daysFailed: 0,
      skipped: 'busy',
    })
    await runTaskBackfillIfNeeded({
      taskMiner,
      provider: makeProvider(true),
      storage: makeStorage(false),
      delayMs: 0,
    })
    expect(setBackfillPending).toHaveBeenLastCalledWith(false)
  })

  it('releases priority when the backfill throws (retries next launch)', async () => {
    const { taskMiner, setBackfillPending } = makeMiner(new Error('boom'))
    await runTaskBackfillIfNeeded({
      taskMiner,
      provider: makeProvider(true),
      storage: makeStorage(false),
      delayMs: 0,
    })
    expect(setBackfillPending).toHaveBeenLastCalledWith(false)
  })
})
