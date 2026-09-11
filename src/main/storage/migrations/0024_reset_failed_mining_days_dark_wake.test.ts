import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { migration } from './0024_reset_failed_mining_days_dark_wake'
import { StorageService } from '../index'
import { applyMigrations } from '../migrator'
import { deleteDbFiles } from '../test-utils'

describe('0024_reset_failed_mining_days_dark_wake', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_migration_0024_test.db')
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

  it('drops failed days and leaves every other status untouched', () => {
    const db = storage.getDatabase()
    const insert = db.prepare(
      `INSERT INTO mining_days (day, status, attempts, last_error, enqueued_at, next_attempt_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
    )
    insert.run('2026-09-07', 'failed', 3, 'getaddrinfo ENOTFOUND openrouter.ai', null)
    insert.run('2026-09-08', 'pending', 1, 'timeout', 123)
    insert.run('2026-09-09', 'running', 1, null, null)
    insert.run('2026-09-10', 'completed', 1, null, null)

    migration.up(db)

    const rows = db.prepare(`SELECT day, status, attempts FROM mining_days ORDER BY day`).all()
    expect(rows).toEqual([
      { day: '2026-09-08', status: 'pending', attempts: 1 },
      { day: '2026-09-09', status: 'running', attempts: 1 },
      { day: '2026-09-10', status: 'completed', attempts: 1 },
    ])
  })
})
