import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { PeriodicJob } from './periodic-job'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('PeriodicJob', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs on start and on each interval', async () => {
    const run = vi.fn(async () => {})
    const job = new PeriodicJob({ name: 'test', intervalMs: 1000, run })

    job.start()
    expect(run).toHaveBeenCalledWith('startup', false)

    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledWith('interval', false)
    expect(run).toHaveBeenCalledTimes(2)

    await job.stop()
  })

  it('coalesces requests that land during a run into one forced rerun', async () => {
    const first = deferred()
    const run = vi.fn(async () => {
      if (run.mock.calls.length === 1) await first.promise
    })
    const job = new PeriodicJob({ name: 'test', intervalMs: 1000, run })

    const started = job.run('startup')
    job.kick('interval')
    void job.run('manual', true)
    first.resolve()
    await started

    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenLastCalledWith('coalesced', true)
  })

  it('stop() waits for the in-flight run', async () => {
    const gate = deferred()
    let finished = false
    const run = vi.fn(async () => {
      await gate.promise
      finished = true
    })
    const job = new PeriodicJob({ name: 'test', intervalMs: 1000, run })

    job.start()
    const stopped = job.stop()
    expect(finished).toBe(false)

    gate.resolve()
    await stopped
    expect(finished).toBe(true)
  })

  it('ignores kicks and runs after stop()', async () => {
    const run = vi.fn(async () => {})
    const job = new PeriodicJob({ name: 'test', intervalMs: 1000, run })

    job.start()
    await job.stop()
    run.mockClear()

    job.kick('resume')
    await job.run('manual', true)
    await vi.advanceTimersByTimeAsync(1000)

    expect(run).not.toHaveBeenCalled()
  })
})
