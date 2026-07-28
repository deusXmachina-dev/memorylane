import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { StorageService } from '../storage'
import { applyMigrations } from '../storage/migrator'
import { deleteDbFiles, createStoredActivity } from '../storage/test-utils'
import { stripDatabaseForUpload } from './strip-database-for-upload'

const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_strip_test.db')
const COPY_DB_PATH = path.join(os.tmpdir(), 'temp_strip_copy.db')

describe('stripDatabaseForUpload', () => {
  let storage: StorageService

  async function setupAndBackup(): Promise<void> {
    storage = new StorageService(TEST_DB_PATH)
    applyMigrations(storage.getDatabase())

    storage.activities.add(
      createStoredActivity({ id: 'act-1', summary: 'hello', ocrText: 'secret ocr' }),
    )

    const db = storage.getDatabase()
    db.exec(`INSERT INTO user_context (id, short_summary, detailed_summary, updated_at)
             VALUES (1, 'short', 'detailed', ${Date.now()})`)

    await storage.getDatabase().backup(COPY_DB_PATH)
  }

  afterEach(() => {
    storage?.close()
    deleteDbFiles(TEST_DB_PATH)
    deleteDbFiles(COPY_DB_PATH)
  })

  it('drops FTS virtual table', async () => {
    await setupAndBackup()
    stripDatabaseForUpload(COPY_DB_PATH, { detailLevel: 'summary' })

    const db = new Database(COPY_DB_PATH)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE name = 'activities_fts'").all()
    db.close()
    expect(tables).toHaveLength(0)
  })

  it('preserves vec virtual table', async () => {
    await setupAndBackup()
    stripDatabaseForUpload(COPY_DB_PATH, { detailLevel: 'summary' })

    const db = new Database(COPY_DB_PATH)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE name = 'activities_vec'").all()
    db.close()
    expect(tables).toHaveLength(1)
  })

  it('preserves user_context', async () => {
    await setupAndBackup()
    stripDatabaseForUpload(COPY_DB_PATH, { detailLevel: 'summary' })

    const db = new Database(COPY_DB_PATH)
    const userContext = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'user_context'")
      .all()
    db.close()
    expect(userContext).toHaveLength(1)
  })

  it('drops FTS triggers', async () => {
    await setupAndBackup()
    stripDatabaseForUpload(COPY_DB_PATH, { detailLevel: 'summary' })

    const db = new Database(COPY_DB_PATH)
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all() as {
      name: string
    }[]
    db.close()
    expect(triggers.map((t) => t.name)).not.toContain('activities_ai')
    expect(triggers.map((t) => t.name)).not.toContain('activities_ad')
    expect(triggers.map((t) => t.name)).not.toContain('activities_au')
  })

  it('strips ocr_text (vector column no longer exists; embeddings live in activities_vec)', async () => {
    await setupAndBackup()
    stripDatabaseForUpload(COPY_DB_PATH, { detailLevel: 'summary' })

    const db = new Database(COPY_DB_PATH)
    const columns = db.prepare('PRAGMA table_info(activities)').all() as { name: string }[]
    const columnNames = columns.map((c) => c.name)
    db.close()

    expect(columnNames).not.toContain('ocr_text')
    expect(columnNames).not.toContain('vector')
  })

  it('preserves activities data (kept columns)', async () => {
    await setupAndBackup()
    stripDatabaseForUpload(COPY_DB_PATH, { detailLevel: 'summary' })

    const db = new Database(COPY_DB_PATH)
    const row = db
      .prepare('SELECT id, summary, app_name, window_title FROM activities WHERE id = ?')
      .get('act-1') as {
      id: string
      summary: string
      app_name: string
      window_title: string
    }
    db.close()

    expect(row.id).toBe('act-1')
    expect(row.summary).toBe('hello')
  })

  it('preserves schema_migrations', async () => {
    await setupAndBackup()
    stripDatabaseForUpload(COPY_DB_PATH, { detailLevel: 'summary' })

    const db = new Database(COPY_DB_PATH)
    const migrations = db.prepare('SELECT name FROM schema_migrations').all()
    db.close()

    expect(migrations.length).toBeGreaterThan(0)
  })

  it('is idempotent (running twice does not throw)', async () => {
    await setupAndBackup()
    stripDatabaseForUpload(COPY_DB_PATH, { detailLevel: 'summary' })
    expect(() => stripDatabaseForUpload(COPY_DB_PATH, { detailLevel: 'summary' })).not.toThrow()
  })

  describe('detailed mode', () => {
    it('preserves user_context and ocr_text', async () => {
      await setupAndBackup()
      stripDatabaseForUpload(COPY_DB_PATH, { detailLevel: 'detailed' })

      const db = new Database(COPY_DB_PATH)

      const userContext = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'user_context'")
        .all()
      expect(userContext).toHaveLength(1)

      const columns = db.prepare('PRAGMA table_info(activities)').all() as { name: string }[]
      const columnNames = columns.map((c) => c.name)
      expect(columnNames).toContain('ocr_text')

      const row = db.prepare('SELECT ocr_text FROM activities WHERE id = ?').get('act-1') as {
        ocr_text: string
      }
      expect(row.ocr_text).toBe('secret ocr')

      db.close()
    })

    it('preserves FTS table and triggers', async () => {
      await setupAndBackup()
      stripDatabaseForUpload(COPY_DB_PATH, { detailLevel: 'detailed' })

      const db = new Database(COPY_DB_PATH)

      const fts = db.prepare("SELECT name FROM sqlite_master WHERE name = 'activities_fts'").all()
      expect(fts).toHaveLength(1)

      const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all() as {
        name: string
      }[]
      const triggerNames = triggers.map((t) => t.name)
      expect(triggerNames).toContain('activities_ai')

      db.close()
    })

    it('is idempotent (running twice does not throw)', async () => {
      await setupAndBackup()
      stripDatabaseForUpload(COPY_DB_PATH, { detailLevel: 'detailed' })
      expect(() => stripDatabaseForUpload(COPY_DB_PATH, { detailLevel: 'detailed' })).not.toThrow()
    })
  })
})
