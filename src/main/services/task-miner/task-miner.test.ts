import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

// scheduleRun() only arms the settle timer once the DB has at least this many
// activities, so seed that many to reach the timer branch.
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

  it('is true once a run is armed (settle timer set), before it fires', () => {
    vi.useFakeTimers()
    seedActivities(storage, PATTERN_DETECTION_CONFIG.MIN_ACTIVITIES)
    const miner = new TaskMiner(storage, configuredProvider, embedder)
    miner.updateModel('test/model')

    expect(miner.isBusy()).toBe(false)
    miner.scheduleRun()
    // The settle timer is armed but has not fired — this is exactly the
    // in-flight state a wipe must not slip past.
    expect(miner.isBusy()).toBe(true)
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

  beforeEach(() => {
    deleteDbFiles(TEST_DB_PATH)
    storage = new StorageService(TEST_DB_PATH)
    applyMigrations(storage.getDatabase())
    miner = new TaskMiner(storage, configuredProvider, embedder)
    miner.updateModel('test/model')
    mockedRunDetection.mockReset()
    mockedRunClustering.mockClear()
    // Default: a successful mine that commits the day like the real one does.
    mockedRunDetection.mockImplementation(async (_provider, _storage, _embedder, config) => {
      config?.onCommit?.({
        candidatesFromScan: 1,
        candidatesKept: 1,
        candidatesRejected: 0,
        tokensIn: 10,
        tokensOut: 5,
      })
      return {} as never
    })
  })

  afterEach(() => {
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

  it('skips days that already have sightings without re-mining them', async () => {
    seedDays(2)
    storage.sightings.add({
      id: 'existing',
      title: 't',
      subject: 's',
      description: 'd',
      steps: [],
      apps: [],
      activityIds: ['act-2'],
      startedAt: dayStart(2) + 1000,
      endedAt: dayStart(2) + 2000,
      interactionMin: 1,
      runId: 'r',
      detectedAt: dayStart(2) + 2000,
    })

    const summary = await miner.sweepNow(configuredProvider)

    expect(summary).toMatchObject({ daysMined: 1, daysSkipped: 1 })
    expect(mockedRunDetection).toHaveBeenCalledTimes(1)
    const skipped = storage.miningDays.getAll().find((d) => d.day === localLabel(2))
    expect(skipped?.status).toBe('completed')
    expect(skipped?.stats).toEqual({ skippedReason: 'had-sightings' })
  })

  it('records a failed attempt, stops the sweep, and retries on the next one', async () => {
    seedDays(3)
    mockedRunDetection.mockRejectedValueOnce(new Error('provider down'))

    const first = await miner.sweepNow(configuredProvider)
    expect(first).toMatchObject({ daysMined: 0, daysFailed: 1 })
    // Sweep stopped: the two newer days were never attempted.
    expect(mockedRunDetection).toHaveBeenCalledTimes(1)
    const failedDay = storage.miningDays.getAll().find((d) => d.day === localLabel(3))
    expect(failedDay?.status).toBe('pending')
    expect(failedDay?.lastError).toBe('provider down')

    const second = await miner.sweepNow(configuredProvider)
    expect(second).toMatchObject({ daysMined: 3, daysFailed: 0 })
  })

  it('marks a day failed after exhausting attempts and sweeps past it', async () => {
    seedDays(2)
    for (let i = 0; i < TASK_BACKFILL.MAX_DAY_ATTEMPTS; i++) {
      mockedRunDetection.mockRejectedValueOnce(new Error(`boom ${i + 1}`))
      await miner.sweepNow(configuredProvider)
    }

    const failed = storage.miningDays.getFailed()
    expect(failed.map((d) => d.day)).toEqual([localLabel(2)])
    expect(failed[0].attempts).toBe(TASK_BACKFILL.MAX_DAY_ATTEMPTS)

    // The exhausted day is unclaimable, so the next sweep flows past it.
    const next = await miner.sweepNow(configuredProvider)
    expect(next).toMatchObject({ daysMined: 1, daysFailed: 0 })
    const yesterday = storage.miningDays.getAll().find((d) => d.day === localLabel(1))
    expect(yesterday?.status).toBe('completed')
  })

  it('clusters at the barrier and once at the end', async () => {
    seedDays(7)

    await miner.sweepNow(configuredProvider)

    // 7 mined days with a barrier of 5 → one barrier pass + one final pass.
    expect(TASK_BACKFILL.CLUSTER_EVERY_DAYS).toBe(5)
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

  it('scheduleRun arms nothing when every day is already settled', async () => {
    seedDays(2)
    // Enough activities to pass the MIN_ACTIVITIES guard, all inside days the
    // sweep below settles — the pending check must be what stands down.
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
    await miner.sweepNow(configuredProvider)

    miner.scheduleRun()

    expect(miner.isBusy()).toBe(false)
  })

  it('startup resets a stale running day so the sweep can retry it', async () => {
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
