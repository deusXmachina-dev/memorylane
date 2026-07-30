import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { APICallError } from 'ai'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from '@main/storage'
import { applyMigrations } from '@main/storage/migrator'
import { deleteDbFiles, v } from '@main/storage/test-utils'
import type { InferenceProvider } from '@main/llm'
import { PATTERN_DETECTION_CONFIG, TASK_BACKFILL } from '../../../shared/constants'
import { TaskMiner } from '.'
import { runDetection } from './run-detection'
import { runClustering } from './clustering'
import type { MinerEmbedder } from './types'

vi.mock('./run-detection', () => ({ runDetection: vi.fn() }))
vi.mock('./clustering', () => ({ runClustering: vi.fn(async () => ({})) }))

const mockedRunDetection = vi.mocked(runDetection)
const mockedRunClustering = vi.mocked(runClustering)

const configuredProvider = { isConfigured: () => true } as InferenceProvider
const embedder: MinerEmbedder = {
  embed: async () => [0.1, 0.2, 0.3],
  embedBatch: async (texts) => texts.map(() => [0.1, 0.2, 0.3]),
}

// scheduleRun() only sweeps once the DB has at least this many activities,
// so seed that many to reach the sweep branch.
const seedActivities = (storage: StorageService, count: number): void => {
  for (let i = 0; i < count; i++) {
    storage.activities.add({
      id: `act-${i}`,
      appName: 'TestApp',
      windowTitle: 'w',
      tld: null,
      startTimestamp: 1000 + i,
      endTimestamp: 2000 + i,
      summary: 's',
      summaryModel: '',
      ocrText: '',
      vector: v(0.1),
    })
  }
}

describe('TaskMiner.isBusy', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_task_miner_busy_test.db')
  let storage: StorageService

  beforeEach(() => {
    deleteDbFiles(TEST_DB_PATH)
    storage = new StorageService(TEST_DB_PATH)
    applyMigrations(storage.getDatabase())
  })

  afterEach(() => {
    vi.useRealTimers()
    storage.close()
    deleteDbFiles(TEST_DB_PATH)
  })

  it('is false on a fresh, idle miner', () => {
    const miner = new TaskMiner(storage, configuredProvider, embedder)
    expect(miner.isBusy()).toBe(false)
  })

  it('is true while a sweep is in flight', async () => {
    seedActivities(storage, PATTERN_DETECTION_CONFIG.MIN_ACTIVITIES)
    const miner = new TaskMiner(storage, configuredProvider, embedder)
    miner.updateModel('test/model')

    expect(miner.isBusy()).toBe(false)
    miner.scheduleRun()
    // The sweep started synchronously — this is exactly the in-flight state a
    // wipe must not slip past.
    expect(miner.isBusy()).toBe(true)
    while (miner.isBusy()) await Promise.resolve()
  })
})

describe('TaskMiner sweep', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_task_miner_sweep_test.db')
  let storage: StorageService
  let miner: TaskMiner

  const localLabel = (daysBack: number): string => {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const dayStart = (daysBack: number): number => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack).getTime()
  }

  // One activity per day, `days` days back through yesterday, so ensureEnqueued
  // bounds the window to exactly those days.
  const seedDays = (days: number): void => {
    for (let back = days; back >= 1; back--) {
      storage.activities.add({
        id: `act-${back}`,
        appName: 'TestApp',
        windowTitle: 'w',
        tld: null,
        startTimestamp: dayStart(back) + 1000,
        endTimestamp: dayStart(back) + 2000,
        summary: 's',
        summaryModel: '',
        ocrText: '',
        vector: v(0.1),
      })
    }
  }

  // Enough activities to pass the MIN_ACTIVITIES guard, all inside already-seeded
  // days, so scheduleRun can reach the sweep branch.
  const seedFiller = (): void => {
    for (let i = 0; i < PATTERN_DETECTION_CONFIG.MIN_ACTIVITIES; i++) {
      storage.activities.add({
        id: `filler-${i}`,
        appName: 'TestApp',
        windowTitle: 'w',
        tld: null,
        startTimestamp: dayStart(1) + 3000 + i,
        endTimestamp: dayStart(1) + 4000 + i,
        summary: 's',
        summaryModel: '',
        ocrText: '',
        vector: v(0.1),
      })
    }
  }

  const commitDay: typeof runDetection = async (_provider, _storage, _embedder, config) => {
    config?.onCommit?.({
      candidatesFromScan: 1,
      candidatesKept: 1,
      candidatesRejected: 0,
      tokensIn: 10,
      tokensOut: 5,
    })
    return {} as never
  }

  beforeEach(() => {
    deleteDbFiles(TEST_DB_PATH)
    storage = new StorageService(TEST_DB_PATH)
    applyMigrations(storage.getDatabase())
    miner = new TaskMiner(storage, configuredProvider, embedder)
    miner.updateModel('test/model')
    mockedRunDetection.mockReset()
    mockedRunClustering.mockClear()
    mockedRunDetection.mockImplementation(commitDay)
  })

  afterEach(() => {
    vi.useRealTimers()
    storage.close()
    deleteDbFiles(TEST_DB_PATH)
  })

  it('enqueues missing days bounded by the oldest activity and mines oldest-first', async () => {
    seedDays(3)

    const summary = await miner.sweepNow(configuredProvider)

    expect(summary.daysMined).toBe(3)
    const lookbacks = mockedRunDetection.mock.calls.map(([, , , cfg]) => cfg?.lookbackDays)
    expect(lookbacks).toEqual([3, 2, 1])
    const all = storage.miningDays.getAll()
    expect(all.map((d) => d.day)).toEqual([localLabel(3), localLabel(2), localLabel(1)])
    expect(all.every((d) => d.status === 'completed')).toBe(true)
    expect(all[0].stats).toMatchObject({ candidatesKept: 1 })
  })

  const seedSighting = (back: number): void => {
    storage.sightings.add({
      id: `existing-${back}`,
      title: 't',
      subject: 's',
      description: 'd',
      steps: [],
      apps: [],
      activityIds: [`act-${back}`],
      startedAt: dayStart(back) + 1000,
      endedAt: dayStart(back) + 2000,
      interactionMin: 1,
      runId: 'r',
      detectedAt: dayStart(back) + 2000,
    })
  }

  it('skips days that already have sightings without re-mining them', async () => {
    seedDays(2)
    seedSighting(2)

    const summary = await miner.sweepNow(configuredProvider)

    expect(summary).toMatchObject({ daysMined: 1, daysSkipped: 1 })
    expect(mockedRunDetection).toHaveBeenCalledTimes(1)
    const skipped = storage.miningDays.getAll().find((d) => d.day === localLabel(2))
    expect(skipped?.status).toBe('completed')
    expect(skipped?.stats).toEqual({ skippedReason: 'had-sightings' })
  })

  it('skips past a failed day, keeps mining, and retries it after its cooldown', async () => {
    vi.useFakeTimers()
    seedDays(3)
    mockedRunDetection.mockRejectedValueOnce(new Error('provider down'))

    const first = await miner.sweepNow(configuredProvider)
    expect(first).toMatchObject({ daysMined: 2, daysFailed: 1, aborted: false })
    expect(mockedRunDetection).toHaveBeenCalledTimes(3)
    const failedDay = storage.miningDays.getAll().find((d) => d.day === localLabel(3))
    expect(failedDay?.status).toBe('pending')
    expect(failedDay?.lastError).toBe('provider down')
    expect(failedDay?.nextAttemptAt).toBe(Date.now() + TASK_BACKFILL.DAY_COOLDOWN_INITIAL_MS)

    const gated = await miner.sweepNow(configuredProvider)
    expect(gated).toMatchObject({ daysMined: 0, daysFailed: 0, skipped: 'cooling-down' })

    vi.advanceTimersByTime(TASK_BACKFILL.DAY_COOLDOWN_INITIAL_MS)
    const second = await miner.sweepNow(configuredProvider)
    expect(second).toMatchObject({ daysMined: 1, daysFailed: 0 })
  })

  it('marks a day failed after exhausting attempts and sweeps past it', async () => {
    vi.useFakeTimers()
    seedDays(2)
    for (let i = 0; i < TASK_BACKFILL.MAX_DAY_ATTEMPTS; i++) {
      mockedRunDetection.mockRejectedValueOnce(new Error(`boom ${i + 1}`))
      await miner.sweepNow(configuredProvider)
      vi.advanceTimersByTime(TASK_BACKFILL.DAY_COOLDOWN_MAX_MS)
    }

    const failed = storage.miningDays.getAll().filter((d) => d.status === 'failed')
    expect(failed.map((d) => d.day)).toEqual([localLabel(2)])
    expect(failed[0].attempts).toBe(TASK_BACKFILL.MAX_DAY_ATTEMPTS)

    // The exhausted day is unclaimable, so the next sweep flows past it.
    const next = await miner.sweepNow(configuredProvider)
    expect(next).toMatchObject({ daysMined: 0, daysFailed: 0 })
    const yesterday = storage.miningDays.getAll().find((d) => d.day === localLabel(1))
    expect(yesterday?.status).toBe('completed')
  })

  it('clusters at the barrier and once at the end', async () => {
    seedDays(7)

    await miner.sweepNow(configuredProvider)

    // 7 mined days with a barrier of 5 → a full wave, then a short one.
    expect(TASK_BACKFILL.CLUSTER_EVERY_DAYS).toBe(5)
    expect(mockedRunClustering).toHaveBeenCalledTimes(2)
  })

  it('mines days concurrently once the ledger has a backlog', async () => {
    seedDays(TASK_BACKFILL.CLUSTER_EVERY_DAYS + 3)
    let inFlight = 0
    let peak = 0
    mockedRunDetection.mockImplementation(async (...args) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      inFlight--
      return commitDay(...args)
    })

    const summary = await miner.sweepNow(configuredProvider)

    expect(summary.daysMined).toBe(TASK_BACKFILL.CLUSTER_EVERY_DAYS + 3)
    // A wave never claims past the barrier, so that caps the peak too.
    expect(peak).toBe(Math.min(TASK_BACKFILL.SWEEP_CONCURRENCY, TASK_BACKFILL.CLUSTER_EVERY_DAYS))
  })

  it('mines one day at a time without a backlog', async () => {
    seedDays(TASK_BACKFILL.CLUSTER_EVERY_DAYS)
    let inFlight = 0
    let peak = 0
    mockedRunDetection.mockImplementation(async (...args) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await Promise.resolve()
      inFlight--
      return commitDay(...args)
    })

    await miner.sweepNow(configuredProvider)

    expect(peak).toBe(1)
  })

  it('never claims more than CLUSTER_EVERY_DAYS days before a wave clusters', async () => {
    seedDays(TASK_BACKFILL.CLUSTER_EVERY_DAYS + 3)
    const clustersBefore: number[] = []
    mockedRunDetection.mockImplementation(async (...args) => {
      clustersBefore.push(mockedRunClustering.mock.calls.length)
      return commitDay(...args)
    })

    await miner.sweepNow(configuredProvider)

    expect(clustersBefore).toEqual([0, 0, 0, 0, 0, 1, 1, 1])
    expect(mockedRunClustering).toHaveBeenCalledTimes(2)
  })

  it('counts mined days, not claims, toward the clustering barrier', async () => {
    seedDays(11)
    for (const back of [11, 10, 9, 8]) seedSighting(back)

    const summary = await miner.sweepNow(configuredProvider)

    // The first wave claims 5 days but mines only one — four had-sightings
    // skips must not buy a clustering pass. 7 mined → one barrier + one final.
    expect(summary).toMatchObject({ daysMined: 7, daysSkipped: 4 })
    expect(mockedRunClustering).toHaveBeenCalledTimes(2)
  })

  it('clusters with the remote cluster-model override when one is set', async () => {
    seedDays(1)
    miner.updateModel('mining/model')
    miner.updateClusterModel('cluster/model')

    await miner.sweepNow(configuredProvider)

    expect(mockedRunClustering).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'cluster/model' }),
    )
  })

  it('clusters with the mining model when no cluster override is set', async () => {
    seedDays(1)
    miner.updateModel('mining/model')
    miner.updateClusterModel(null)

    await miner.sweepNow(configuredProvider)

    expect(mockedRunClustering).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'mining/model' }),
    )
  })

  const drain = async (): Promise<void> => {
    while (miner.isBusy()) await Promise.resolve()
  }

  it('scheduleRun stands down when every day is already settled', async () => {
    seedDays(2)
    seedFiller()
    await miner.sweepNow(configuredProvider)

    miner.scheduleRun()

    expect(miner.isBusy()).toBe(false)
  })

  it('the poll started by startup() triggers a sweep', async () => {
    vi.useFakeTimers()
    seedDays(2)
    seedFiller()

    miner.startup()
    expect(miner.isBusy()).toBe(false)

    vi.advanceTimersByTime(TASK_BACKFILL.POLL_INTERVAL_MS)
    expect(miner.isBusy()).toBe(true)
    await drain()
    expect(storage.miningDays.getAll().every((d) => d.status === 'completed')).toBe(true)
  })

  it('a single day failure gates only that day, not the next sweep', async () => {
    vi.useFakeTimers()
    seedDays(2)
    seedFiller()
    mockedRunDetection.mockRejectedValueOnce(new Error('blip'))
    const first = await miner.sweepNow(configuredProvider)
    expect(first).toMatchObject({ daysMined: 1, daysFailed: 1, aborted: false })

    miner.scheduleRun()
    expect(miner.isBusy()).toBe(false)

    vi.advanceTimersByTime(TASK_BACKFILL.DAY_COOLDOWN_INITIAL_MS)
    miner.scheduleRun()
    expect(miner.isBusy()).toBe(true)
    await drain()
    expect(storage.miningDays.getAll().every((d) => d.status === 'completed')).toBe(true)
  })

  it('aborts the sweep after consecutive failures and gates the next one', async () => {
    vi.useFakeTimers()
    seedDays(5)
    seedFiller()
    mockedRunDetection.mockRejectedValue(new Error('down'))

    const summary = await miner.sweepNow(configuredProvider)
    expect(summary).toMatchObject({
      daysFailed: TASK_BACKFILL.SWEEP_MAX_CONSECUTIVE_FAILURES,
      aborted: true,
    })
    expect(mockedRunDetection).toHaveBeenCalledTimes(TASK_BACKFILL.SWEEP_MAX_CONSECUTIVE_FAILURES)
    expect(storage.miningDays.getAll().filter((d) => d.attempts === 0)).toHaveLength(2)

    miner.scheduleRun()
    expect(miner.isBusy()).toBe(false)

    vi.advanceTimersByTime(TASK_BACKFILL.SWEEP_ABORT_BACKOFF_MS)
    miner.scheduleRun()
    expect(miner.isBusy()).toBe(true)
    await drain()
  })

  it('aborts a backlog sweep no more than a wave deep', async () => {
    seedDays(TASK_BACKFILL.CLUSTER_EVERY_DAYS + 3)
    mockedRunDetection.mockRejectedValue(new Error('down'))

    const summary = await miner.sweepNow(configuredProvider)

    expect(summary).toMatchObject({ aborted: true, abortReason: 'failures' })
    // Days still in flight when the signature lands go back unspent, so an
    // outage costs the same attempts at concurrency 5 as it did at 1.
    expect(summary.daysFailed).toBe(TASK_BACKFILL.SWEEP_MAX_CONSECUTIVE_FAILURES)
    expect(mockedRunClustering).not.toHaveBeenCalled()
    // Workers claim their own day, so an abort leaves nothing half-claimed for
    // the startup crash recovery to unwind.
    expect(storage.miningDays.countByStatus().running).toBe(0)
    const spent = storage.miningDays.getAll().filter((d) => d.attempts > 0)
    expect(spent).toHaveLength(TASK_BACKFILL.SWEEP_MAX_CONSECUTIVE_FAILURES)
  })

  it('hands a throttled day back unspent and stops the sweep', async () => {
    seedDays(TASK_BACKFILL.CLUSTER_EVERY_DAYS + 3)
    seedFiller()
    mockedRunDetection.mockRejectedValue(
      new APICallError({
        message: 'rate limited',
        url: 'https://provider.test',
        requestBodyValues: {},
        statusCode: 429,
      }),
    )

    const summary = await miner.sweepNow(configuredProvider)

    expect(summary).toMatchObject({
      daysMined: 0,
      daysFailed: 0,
      aborted: true,
      abortReason: 'rate-limit',
    })
    // A rate limit is the sweep's own concurrency talking back, not a bad day:
    // no attempt is spent, so a burst can't march days to terminal `failed`.
    const all = storage.miningDays.getAll()
    expect(all.every((d) => d.status === 'pending' && d.attempts === 0)).toBe(true)
    expect(mockedRunClustering).not.toHaveBeenCalled()

    // The days are claimable again immediately; the sweep-level backoff waits.
    miner.scheduleRun()
    expect(miner.isBusy()).toBe(false)
  })

  it('successes reset the shared failure count between waves', async () => {
    seedDays(TASK_BACKFILL.CLUSTER_EVERY_DAYS + 3)
    // Two failures per wave (days 8 and 6, then 3 and 2), successes in between.
    mockedRunDetection.mockImplementation(async (...args) => {
      if ([8, 6, 3, 2].includes(args[3]?.lookbackDays ?? 0)) throw new Error('flaky')
      return commitDay(...args)
    })

    const summary = await miner.sweepNow(configuredProvider)

    // Four failed days total, but never three without a success landing
    // between them — the count is shared, so the reset has to cross workers.
    expect(summary).toMatchObject({ daysMined: 4, daysFailed: 4, aborted: false })
  })

  it('a success resets the consecutive-failure count', async () => {
    seedDays(TASK_BACKFILL.CLUSTER_EVERY_DAYS)
    mockedRunDetection.mockImplementation(async (...args) => {
      if ((args[3]?.lookbackDays ?? 0) % 2 === 1) throw new Error('flaky')
      return commitDay(...args)
    })

    const summary = await miner.sweepNow(configuredProvider)
    expect(summary).toMatchObject({ daysMined: 2, daysFailed: 3, aborted: false })
    expect(mockedRunDetection).toHaveBeenCalledTimes(TASK_BACKFILL.CLUSTER_EVERY_DAYS)
  })

  it('had-sightings skips do not reset the consecutive-failure count', async () => {
    seedDays(5)
    seedSighting(4)
    seedSighting(2)
    mockedRunDetection.mockRejectedValue(new Error('down'))

    // Skips are DB-only — not evidence the provider recovered — so the
    // interleaved failures still read as an outage and abort the sweep.
    const summary = await miner.sweepNow(configuredProvider)
    expect(summary).toMatchObject({ daysFailed: 3, daysSkipped: 2, aborted: true })
    expect(mockedRunDetection).toHaveBeenCalledTimes(3)
  })

  it('skips the final clustering pass when the sweep aborts', async () => {
    seedDays(4)
    mockedRunDetection.mockImplementationOnce(commitDay).mockRejectedValue(new Error('down'))

    const summary = await miner.sweepNow(configuredProvider)
    expect(summary).toMatchObject({ daysMined: 1, daysFailed: 3, aborted: true })
    expect(mockedRunClustering).not.toHaveBeenCalled()
  })

  it('startup resets a stale running day so the sweep can retry it', async () => {
    vi.useFakeTimers()
    seedDays(1)
    storage.miningDays.enqueueMissing([localLabel(1)])
    storage.miningDays.claimOldestPending() // simulate a crash mid-mine

    expect(storage.miningDays.getRunningDay()).toBe(localLabel(1))
    miner.startup()

    const row = storage.miningDays.getAll()[0]
    expect(row.status).toBe('pending')
    expect(row.lastError).toBe('interrupted')
  })

  it('idles without a model: no ledger claim, and resumes once a model arrives', async () => {
    seedDays(2)
    miner.updateModel('')

    const summary = await miner.sweepNow(configuredProvider)
    expect(summary).toMatchObject({ daysMined: 0, skipped: 'no-model' })
    expect(storage.miningDays.getAll()).toEqual([])
    expect(mockedRunDetection).not.toHaveBeenCalled()

    miner.scheduleRun()
    expect(miner.isBusy()).toBe(false)
    expect(storage.miningDays.getAll()).toEqual([])

    miner.updateModel('test/model')
    const resumed = await miner.sweepNow(configuredProvider)
    expect(resumed.daysMined).toBe(2)
  })
})
