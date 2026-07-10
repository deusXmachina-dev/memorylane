import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from '@main/storage'
import { applyMigrations } from '@main/storage/migrator'
import { deleteDbFiles, v } from '@main/storage/test-utils'
import type { InferenceProvider } from '@main/llm'
import { PATTERN_DETECTION_CONFIG } from '../../../shared/constants'
import { TaskMiner } from '.'
import type { MinerEmbedder } from './types'

const configuredProvider = { isConfigured: () => true } as unknown as InferenceProvider
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

    expect(miner.isBusy()).toBe(false)
    miner.scheduleRun()
    // The settle timer is armed but has not fired — this is exactly the
    // in-flight state a wipe must not slip past.
    expect(miner.isBusy()).toBe(true)
  })
})
