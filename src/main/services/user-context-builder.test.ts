import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from '@main/storage'
import { applyMigrations } from '@main/storage/migrator'
import { deleteDbFiles, v } from '@main/storage/test-utils'
import type { InferenceProvider } from '@main/llm'
import { USER_CONTEXT_CONFIG } from '../../shared/constants'
import { UserContextBuilder } from './user-context-builder'

const configuredProvider = { isConfigured: () => true } as InferenceProvider

describe('UserContextBuilder scheduling', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_user_context_builder_test.db')
  let storage: StorageService

  beforeEach(() => {
    vi.useFakeTimers()
    deleteDbFiles(TEST_DB_PATH)
    storage = new StorageService(TEST_DB_PATH)
    applyMigrations(storage.getDatabase())
    for (let i = 0; i < USER_CONTEXT_CONFIG.MIN_ACTIVITIES; i++) {
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
  })

  afterEach(() => {
    vi.useRealTimers()
    storage.close()
    deleteDbFiles(TEST_DB_PATH)
  })

  it('idles without a model and arms once one is pushed', () => {
    const builder = new UserContextBuilder(storage, configuredProvider)

    builder.scheduleRun()
    expect(vi.getTimerCount()).toBe(0)

    builder.updateModel('test/model')
    builder.scheduleRun()
    expect(vi.getTimerCount()).toBe(1)
  })

  it('treats a whitespace-only model as absent', () => {
    const builder = new UserContextBuilder(storage, configuredProvider)
    builder.updateModel('   ')
    builder.scheduleRun()
    expect(vi.getTimerCount()).toBe(0)
  })
})
