import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from './index'
import { applyMigrations } from './migrator'
import { deleteDbFiles } from './test-utils'

describe('UploadRunRepository', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_upload_run_repo_test.db')
  let storage: StorageService

  beforeEach(() => {
    deleteDbFiles(TEST_DB_PATH)
    storage = new StorageService(TEST_DB_PATH)
    applyMigrations(storage.getDatabase())
  })

  afterEach(() => {
    storage.close()
    deleteDbFiles(TEST_DB_PATH)
  })

  it('returns null when no upload has ever been recorded', () => {
    expect(storage.uploadRuns.getLastRunTimestamp()).toBeNull()
  })

  it('records an upload timestamp and reads back the latest', () => {
    storage.uploadRuns.record(1000)
    storage.uploadRuns.record(3000)
    storage.uploadRuns.record(2000)

    expect(storage.uploadRuns.getLastRunTimestamp()).toBe(3000)
  })
})
