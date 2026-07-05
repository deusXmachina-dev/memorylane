import { describe, it, expect, vi } from 'vitest'
import { runTaskBackfillIfNeeded } from './backfill-bootstrap'
import type { BackfillSummary } from './types'
import type { TaskMiner } from '.'
import type { BackfillMarker } from './backfill-marker'
import type { InferenceProvider } from '@main/llm'

const makeMarker = (complete: boolean) => {
  const markComplete = vi.fn()
  const marker = {
    isComplete: vi.fn(() => complete),
    markComplete,
  } satisfies BackfillMarker
  return marker
}

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
  it('skips entirely when the marker is already complete', async () => {
    const marker = makeMarker(true)
    const { taskMiner, backfill, setBackfillPending } = makeMiner(okSummary)
    await runTaskBackfillIfNeeded({ taskMiner, provider: makeProvider(true), marker, delayMs: 0 })
    expect(backfill).not.toHaveBeenCalled()
    expect(marker.markComplete).not.toHaveBeenCalled()
    expect(setBackfillPending).not.toHaveBeenCalled()
  })

  it('defers without stamping (or claiming priority) when no provider is configured', async () => {
    const marker = makeMarker(false)
    const { taskMiner, backfill, setBackfillPending } = makeMiner(okSummary)
    await runTaskBackfillIfNeeded({ taskMiner, provider: makeProvider(false), marker, delayMs: 0 })
    expect(backfill).not.toHaveBeenCalled()
    expect(marker.markComplete).not.toHaveBeenCalled()
    expect(setBackfillPending).not.toHaveBeenCalled()
  })

  it('runs the backfill and stamps the marker on success', async () => {
    const marker = makeMarker(false)
    const { taskMiner, backfill } = makeMiner(okSummary)
    await runTaskBackfillIfNeeded({ taskMiner, provider: makeProvider(true), marker, delayMs: 0 })
    expect(backfill).toHaveBeenCalledOnce()
    expect(marker.markComplete).toHaveBeenCalledOnce()
  })

  it('claims priority up front and releases it once the backfill settles', async () => {
    const marker = makeMarker(false)
    const { taskMiner, setBackfillPending } = makeMiner(okSummary)
    await runTaskBackfillIfNeeded({ taskMiner, provider: makeProvider(true), marker, delayMs: 0 })
    expect(setBackfillPending).toHaveBeenNthCalledWith(1, true)
    expect(setBackfillPending).toHaveBeenLastCalledWith(false)
  })

  it('claims priority synchronously, before awaiting the settle delay', () => {
    const marker = makeMarker(false)
    const { taskMiner, setBackfillPending } = makeMiner(okSummary)
    // Do not await — the pending claim must be visible before capture resume
    // arms the scheduled run (i.e. before the first await).
    void runTaskBackfillIfNeeded({ taskMiner, provider: makeProvider(true), marker, delayMs: 50 })
    expect(setBackfillPending).toHaveBeenCalledWith(true)
  })

  it('does not stamp, but releases priority, when the backfill reports skipped (busy)', async () => {
    const marker = makeMarker(false)
    const { taskMiner, setBackfillPending } = makeMiner({
      daysMined: 0,
      daysSkipped: 0,
      daysFailed: 0,
      skipped: 'busy',
    })
    await runTaskBackfillIfNeeded({ taskMiner, provider: makeProvider(true), marker, delayMs: 0 })
    expect(marker.markComplete).not.toHaveBeenCalled()
    expect(setBackfillPending).toHaveBeenLastCalledWith(false)
  })

  it('does not stamp when some days failed, so the gaps are re-mined next launch', async () => {
    const marker = makeMarker(false)
    const { taskMiner, setBackfillPending } = makeMiner({
      daysMined: 4,
      daysSkipped: 25,
      daysFailed: 1,
    })
    await runTaskBackfillIfNeeded({ taskMiner, provider: makeProvider(true), marker, delayMs: 0 })
    expect(marker.markComplete).not.toHaveBeenCalled()
    expect(setBackfillPending).toHaveBeenLastCalledWith(false)
  })

  it('does not stamp, but releases priority, when the backfill throws (retries next launch)', async () => {
    const marker = makeMarker(false)
    const { taskMiner, setBackfillPending } = makeMiner(new Error('boom'))
    await runTaskBackfillIfNeeded({ taskMiner, provider: makeProvider(true), marker, delayMs: 0 })
    expect(marker.markComplete).not.toHaveBeenCalled()
    expect(setBackfillPending).toHaveBeenLastCalledWith(false)
  })
})
