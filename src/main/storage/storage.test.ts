import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { StorageService, StoredActivity } from './index'
import { getMigrationStatus, ensureMigrationsTable, runMigrations } from './migrator'
import { migration as migration0001 } from './migrations/0001_initial_schema'
import { migration as migration0002 } from './migrations/0002_migrate_context_events'
import * as path from 'path'
import * as fs from 'fs'

/**
 * Creates a 384-element vector padded with zeros.
 * The leading values can be specified; the rest default to 0.
 */
function v(...vals: number[]): number[] {
  return Object.assign(new Array(384).fill(0), vals)
}

const deleteDbFiles = (dbPath: string): void => {
  for (const suffix of ['', '-wal', '-shm']) {
    const filePath = dbPath + suffix
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }
}

const createStoredActivity = (
  overrides: Partial<StoredActivity> & { id: string },
): StoredActivity => ({
  id: overrides.id,
  startTimestamp: overrides.startTimestamp ?? Date.now(),
  endTimestamp: overrides.endTimestamp ?? Date.now() + 60000,
  appName: overrides.appName ?? 'TestApp',
  windowTitle: overrides.windowTitle ?? 'Test Window',
  tld: overrides.tld ?? null,
  summary: overrides.summary ?? 'Test activity summary',
  ocrText: overrides.ocrText ?? 'Sample OCR text',
  vector: overrides.vector ?? v(0.1, 0.2, 0.3),
})
const BACKUP_DB_PATH = path.join(process.cwd(), 'temp_storage_backup_test.db')

describe('StorageService', () => {
  const TEST_DB_PATH = path.join(process.cwd(), 'temp_test.db')
  let storage: StorageService

  beforeEach(async () => {
    deleteDbFiles(TEST_DB_PATH)
    storage = new StorageService(TEST_DB_PATH)
    await storage.init()
  })

  afterEach(async () => {
    await storage.close()
    deleteDbFiles(TEST_DB_PATH)
    deleteDbFiles(BACKUP_DB_PATH)
  })

  it('should add and retrieve an activity with all fields', async () => {
    const activity = createStoredActivity({
      id: 'uuid-1',
      startTimestamp: 1000,
      endTimestamp: 5000,
      appName: 'VS Code',
      summary: 'Editing TypeScript',
      ocrText: 'function hello()',
      vector: v(0.1, 0.2, 0.3),
    })

    await storage.addActivity(activity)

    const retrieved = await storage.getActivitiesByIds(['uuid-1'])
    expect(retrieved.length).toBe(1)
    expect(retrieved[0].summary).toBe('Editing TypeScript')
    expect(retrieved[0].appName).toBe('VS Code')
    expect(retrieved[0].ocrText).toBe('function hello()')
    expect(retrieved[0].vector.length).toBe(384)
    expect(retrieved[0].vector[0]).toBeCloseTo(0.1)
  })

  it('should auto-initialize when addActivity is called without prior init', async () => {
    const autoInitStorage = new StorageService(TEST_DB_PATH)

    await autoInitStorage.addActivity(
      createStoredActivity({ id: 'auto-init-1', summary: 'Auto init test' }),
    )

    const retrieved = await autoInitStorage.getActivitiesByIds(['auto-init-1'])
    expect(retrieved.length).toBe(1)
    expect(retrieved[0].id).toBe('auto-init-1')
    expect(retrieved[0].summary).toBe('Auto init test')

    await autoInitStorage.close()
  })

  describe('searchActivitiesFTS', () => {
    it('should return matching results ranked by relevance', async () => {
      await storage.addActivity(
        createStoredActivity({
          id: 'fts-1',
          summary: 'Editing TypeScript handler',
          ocrText: 'function handleRequest()',
        }),
      )
      await storage.addActivity(
        createStoredActivity({
          id: 'fts-2',
          summary: 'Reading documentation',
          ocrText: 'TypeScript handbook page',
        }),
      )

      const results = await storage.searchActivitiesFTS('TypeScript', 10)

      expect(results.length).toBe(2)
      const ids = results.map((r) => r.id)
      expect(ids).toContain('fts-1')
      expect(ids).toContain('fts-2')
    })

    it('should return empty array when table is empty', async () => {
      const results = await storage.searchActivitiesFTS('nonexistent', 10)
      expect(results).toEqual([])
    })

    it('should handle special characters in query without throwing', async () => {
      await storage.addActivity(
        createStoredActivity({ id: 'fts-special', summary: 'Testing quotes "hello"' }),
      )

      const results = await storage.searchActivitiesFTS('"hello" world', 10)
      expect(results.length).toBeGreaterThanOrEqual(0)
    })

    it('should filter by appName', async () => {
      await storage.addActivity(
        createStoredActivity({
          id: 'fts-vs',
          appName: 'VS Code',
          summary: 'TypeScript editing',
        }),
      )
      await storage.addActivity(
        createStoredActivity({
          id: 'fts-chrome',
          appName: 'Chrome',
          summary: 'TypeScript docs',
        }),
      )

      const results = await storage.searchActivitiesFTS('TypeScript', 10, {
        appName: 'VS Code',
      })

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('fts-vs')
    })

    it('should filter by time range', async () => {
      await storage.addActivity(
        createStoredActivity({
          id: 'fts-old',
          startTimestamp: 1000,
          summary: 'TypeScript early',
        }),
      )
      await storage.addActivity(
        createStoredActivity({
          id: 'fts-new',
          startTimestamp: 5000,
          summary: 'TypeScript later',
        }),
      )

      const results = await storage.searchActivitiesFTS('TypeScript', 10, {
        startTime: 3000,
      })

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('fts-new')
    })

    it('should return lightweight ActivitySummary without ocrText or vector', async () => {
      await storage.addActivity(
        createStoredActivity({
          id: 'fts-light',
          summary: 'Lightweight check',
          ocrText: 'should not appear',
        }),
      )

      const results = await storage.searchActivitiesFTS('Lightweight', 10)

      expect(results.length).toBe(1)
      expect(results[0]).toHaveProperty('id')
      expect(results[0]).toHaveProperty('summary')
      expect(results[0]).not.toHaveProperty('ocrText')
      expect(results[0]).not.toHaveProperty('vector')
    })
  })

  describe('searchActivitiesVectors', () => {
    it('should return results ordered by similarity', async () => {
      await storage.addActivity(
        createStoredActivity({ id: 'vec-1', vector: v(1.0), summary: 'First' }),
      )
      await storage.addActivity(
        createStoredActivity({ id: 'vec-2', vector: v(0.9, 0.1), summary: 'Second' }),
      )
      await storage.addActivity(
        createStoredActivity({ id: 'vec-3', vector: v(0.0, 1.0), summary: 'Third' }),
      )

      const results = await storage.searchActivitiesVectors(v(1.0), 10)

      expect(results.length).toBe(3)
      expect(results[0].id).toBe('vec-1')
    })

    it('should return empty array on empty table', async () => {
      const results = await storage.searchActivitiesVectors(v(1.0), 10)
      expect(results).toEqual([])
    })

    it('should filter by appName', async () => {
      await storage.addActivity(
        createStoredActivity({
          id: 'vec-vs',
          appName: 'VS Code',
          vector: v(1.0),
        }),
      )
      await storage.addActivity(
        createStoredActivity({
          id: 'vec-chrome',
          appName: 'Chrome',
          vector: v(0.9, 0.1),
        }),
      )

      const results = await storage.searchActivitiesVectors(v(1.0), 10, {
        appName: 'VS Code',
      })

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('vec-vs')
    })

    it('should filter by time range', async () => {
      await storage.addActivity(
        createStoredActivity({
          id: 'vec-old',
          startTimestamp: 1000,
          vector: v(1.0),
        }),
      )
      await storage.addActivity(
        createStoredActivity({
          id: 'vec-new',
          startTimestamp: 5000,
          vector: v(0.9, 0.1),
        }),
      )

      const results = await storage.searchActivitiesVectors(v(1.0), 10, {
        startTime: 3000,
      })

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('vec-new')
    })

    it('should handle combined filters (appName + time)', async () => {
      await storage.addActivity(
        createStoredActivity({
          id: 'combo-1',
          startTimestamp: 1000,
          appName: 'VS Code',
          vector: v(1.0),
        }),
      )
      await storage.addActivity(
        createStoredActivity({
          id: 'combo-2',
          startTimestamp: 3000,
          appName: 'VS Code',
          vector: v(0.9, 0.1),
        }),
      )
      await storage.addActivity(
        createStoredActivity({
          id: 'combo-3',
          startTimestamp: 3000,
          appName: 'Chrome',
          vector: v(0.8, 0.2),
        }),
      )

      const results = await storage.searchActivitiesVectors(v(1.0), 10, {
        appName: 'VS Code',
        startTime: 2000,
      })

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('combo-2')
    })

    it('should respect limit with filters', async () => {
      for (let i = 0; i < 5; i++) {
        await storage.addActivity(
          createStoredActivity({
            id: `limit-${i}`,
            appName: 'VS Code',
            vector: v(1.0 - i * 0.1, i * 0.1),
          }),
        )
      }

      const results = await storage.searchActivitiesVectors(v(1.0), 2, {
        appName: 'VS Code',
      })

      expect(results.length).toBe(2)
    })

    it('should return lightweight ActivitySummary without ocrText or vector', async () => {
      await storage.addActivity(
        createStoredActivity({
          id: 'vec-light',
          vector: v(1.0),
          ocrText: 'should not appear',
        }),
      )

      const results = await storage.searchActivitiesVectors(v(1.0), 10)

      expect(results.length).toBe(1)
      expect(results[0]).toHaveProperty('id')
      expect(results[0]).toHaveProperty('summary')
      expect(results[0]).not.toHaveProperty('ocrText')
      expect(results[0]).not.toHaveProperty('vector')
    })

    it('should handle appName case-insensitively', async () => {
      await storage.addActivity(
        createStoredActivity({
          id: 'case-1',
          appName: 'VS Code',
          vector: v(1.0),
        }),
      )

      const results = await storage.searchActivitiesVectors(v(1.0), 10, {
        appName: 'vs code',
      })

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('case-1')
    })
  })

  describe('getActivitiesByTimeRange', () => {
    it('should return activities sorted by start_timestamp', async () => {
      await storage.addActivity(
        createStoredActivity({ id: 'time-2', startTimestamp: 2000, appName: 'Chrome' }),
      )
      await storage.addActivity(
        createStoredActivity({ id: 'time-1', startTimestamp: 1000, appName: 'VS Code' }),
      )

      const results = await storage.getActivitiesByTimeRange(null, null)

      expect(results.length).toBe(2)
      expect(results[0].id).toBe('time-1')
      expect(results[1].id).toBe('time-2')
    })

    it('should filter by time range', async () => {
      await storage.addActivity(createStoredActivity({ id: 'range-1', startTimestamp: 1000 }))
      await storage.addActivity(createStoredActivity({ id: 'range-2', startTimestamp: 2000 }))
      await storage.addActivity(createStoredActivity({ id: 'range-3', startTimestamp: 3000 }))

      const results = await storage.getActivitiesByTimeRange(1500, 2500)

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('range-2')
    })

    it('should filter with only startTime', async () => {
      await storage.addActivity(createStoredActivity({ id: 'start-1', startTimestamp: 1000 }))
      await storage.addActivity(createStoredActivity({ id: 'start-2', startTimestamp: 2000 }))
      await storage.addActivity(createStoredActivity({ id: 'start-3', startTimestamp: 3000 }))

      const results = await storage.getActivitiesByTimeRange(2000, null)

      expect(results.length).toBe(2)
      expect(results.find((r) => r.id === 'start-2')).toBeDefined()
      expect(results.find((r) => r.id === 'start-3')).toBeDefined()
    })

    it('should filter with only endTime', async () => {
      await storage.addActivity(createStoredActivity({ id: 'end-1', startTimestamp: 1000 }))
      await storage.addActivity(createStoredActivity({ id: 'end-2', startTimestamp: 2000 }))
      await storage.addActivity(createStoredActivity({ id: 'end-3', startTimestamp: 3000 }))

      const results = await storage.getActivitiesByTimeRange(null, 2000)

      expect(results.length).toBe(2)
      expect(results.find((r) => r.id === 'end-1')).toBeDefined()
      expect(results.find((r) => r.id === 'end-2')).toBeDefined()
    })

    it('should filter by appName case-insensitively', async () => {
      await storage.addActivity(
        createStoredActivity({ id: 'app-1', appName: 'VS Code', startTimestamp: 1000 }),
      )
      await storage.addActivity(
        createStoredActivity({ id: 'app-2', appName: 'Chrome', startTimestamp: 2000 }),
      )

      const results = await storage.getActivitiesByTimeRange(null, null, { appName: 'vs code' })

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('app-1')
    })

    it('should return lightweight ActivitySummary without ocrText or vector', async () => {
      await storage.addActivity(
        createStoredActivity({
          id: 'light-1',
          startTimestamp: 1000,
          ocrText: 'should not appear',
        }),
      )

      const results = await storage.getActivitiesByTimeRange(null, null)

      expect(results.length).toBe(1)
      expect(results[0]).toHaveProperty('id')
      expect(results[0]).toHaveProperty('summary')
      expect(results[0]).not.toHaveProperty('ocrText')
      expect(results[0]).not.toHaveProperty('vector')
    })
  })

  describe('getDateRange', () => {
    it('should return correct oldest and newest timestamps', async () => {
      await storage.addActivity(
        createStoredActivity({ id: 'date-1', startTimestamp: 1000, endTimestamp: 3000 }),
      )
      await storage.addActivity(
        createStoredActivity({ id: 'date-2', startTimestamp: 2000, endTimestamp: 5000 }),
      )

      const range = await storage.getDateRange()

      expect(range.oldest).toBe(1000)
      expect(range.newest).toBe(5000)
    })

    it('should return null values when table is empty', async () => {
      const range = await storage.getDateRange()

      expect(range.oldest).toBeNull()
      expect(range.newest).toBeNull()
    })
  })

  describe('countRows', () => {
    it('should return correct count of activities', async () => {
      expect(await storage.countRows()).toBe(0)

      await storage.addActivity(createStoredActivity({ id: 'count-1' }))
      expect(await storage.countRows()).toBe(1)

      await storage.addActivity(createStoredActivity({ id: 'count-2' }))
      expect(await storage.countRows()).toBe(2)
    })

    it('should create a readable backup while database is open', async () => {
      storage = new StorageService(TEST_DB_PATH)
      storage.activities.add({
        id: 'backup-1',
        startTimestamp: 1000,
        endTimestamp: 2000,
        appName: 'BackupApp',
        windowTitle: 'Backup Window',
        tld: null,
        summary: 'backup summary',
        ocrText: 'backup text',
        vector: v(0.25),
      })

      await storage.backupToFile(BACKUP_DB_PATH)

      const backupDb = new Database(BACKUP_DB_PATH)
      sqliteVec.load(backupDb)
      const row = backupDb
        .prepare('SELECT COUNT(*) as count FROM activities WHERE id = ?')
        .get('backup-1') as { count: number }
      backupDb.close()

      expect(row.count).toBe(1)
    })
  })
})

// ---------------------------------------------------------------------------
// Legacy context_events migration
// ---------------------------------------------------------------------------

const MIGRATION_DB_PATH = path.join(process.cwd(), 'temp_migration_test.db')

/** Seed a raw SQLite database with the legacy context_events schema. */
function seedLegacyDb(
  rows: {
    id: string
    timestamp: number
    text: string
    summary: string
    appName: string
    vector: number[] | null
  }[],
): void {
  const db = new Database(MIGRATION_DB_PATH)
  sqliteVec.load(db)

  db.exec(`
    CREATE TABLE IF NOT EXISTS context_events (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      appName TEXT NOT NULL DEFAULT '',
      vector BLOB
    )
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_context_events_timestamp ON context_events(timestamp)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_context_events_appName ON context_events(appName)')
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS context_events_fts USING fts5(
      text, summary, content='context_events', content_rowid='rowid'
    )
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS context_events_ai AFTER INSERT ON context_events BEGIN
      INSERT INTO context_events_fts(rowid, text, summary) VALUES (new.rowid, new.text, new.summary);
    END
  `)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS context_events_vec USING vec0(
      id TEXT PRIMARY KEY,
      embedding float[384]
    )
  `)

  for (const row of rows) {
    const vectorBlob = row.vector ? Buffer.from(new Float32Array(row.vector).buffer) : null
    db.prepare(
      'INSERT INTO context_events (id, timestamp, text, summary, appName, vector) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(row.id, row.timestamp, row.text, row.summary, row.appName, vectorBlob)
    if (vectorBlob) {
      db.prepare('INSERT INTO context_events_vec (id, embedding) VALUES (?, ?)').run(
        row.id,
        vectorBlob,
      )
    }
  }

  db.close()
}

describe('context_events migration', () => {
  afterEach(async () => {
    deleteDbFiles(MIGRATION_DB_PATH)
  })

  it('should migrate rows into activities with correct column mapping', async () => {
    deleteDbFiles(MIGRATION_DB_PATH)
    seedLegacyDb([
      {
        id: 'evt-1',
        timestamp: 1000,
        text: 'hello world',
        summary: 'greeting',
        appName: 'Terminal',
        vector: v(0.1, 0.2, 0.3),
      },
    ])

    const storage = new StorageService(MIGRATION_DB_PATH)
    await storage.init()

    const rows = await storage.getActivitiesByIds(['evt-1'])
    expect(rows.length).toBe(1)
    const row = rows[0]
    expect(row.startTimestamp).toBe(1000)
    expect(row.endTimestamp).toBe(1000)
    expect(row.appName).toBe('Terminal')
    expect(row.ocrText).toBe('hello world')
    expect(row.summary).toBe('greeting')
    expect(row.windowTitle).toBe('')
    expect(row.tld).toBeNull()
    expect(row.vector[0]).toBeCloseTo(0.1)

    await storage.close()
  })

  it('should make migrated rows searchable via FTS', async () => {
    deleteDbFiles(MIGRATION_DB_PATH)
    seedLegacyDb([
      {
        id: 'fts-evt',
        timestamp: 2000,
        text: 'TypeScript compiler',
        summary: 'compiling project',
        appName: 'Terminal',
        vector: v(0.1, 0.2, 0.3),
      },
    ])

    const storage = new StorageService(MIGRATION_DB_PATH)
    await storage.init()

    const results = await storage.searchActivitiesFTS('compiling', 10)
    expect(results.length).toBe(1)
    expect(results[0].id).toBe('fts-evt')

    await storage.close()
  })

  it('should make migrated rows searchable via vector similarity', async () => {
    deleteDbFiles(MIGRATION_DB_PATH)
    seedLegacyDb([
      {
        id: 'vec-evt',
        timestamp: 3000,
        text: 'code review',
        summary: 'reviewing PR',
        appName: 'Chrome',
        vector: v(1.0),
      },
    ])

    const storage = new StorageService(MIGRATION_DB_PATH)
    await storage.init()

    const results = await storage.searchActivitiesVectors(v(1.0), 10)
    expect(results.length).toBe(1)
    expect(results[0].id).toBe('vec-evt')

    await storage.close()
  })

  it('should drop legacy tables after migration', async () => {
    deleteDbFiles(MIGRATION_DB_PATH)
    seedLegacyDb([
      {
        id: 'drop-evt',
        timestamp: 1000,
        text: 'test',
        summary: 'test',
        appName: 'App',
        vector: v(0.1, 0.2, 0.3),
      },
    ])

    const storage = new StorageService(MIGRATION_DB_PATH)
    await storage.init()

    // Verify legacy tables are gone by opening a raw connection
    const db = new Database(MIGRATION_DB_PATH)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'context_events%'")
      .all()
    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='context_events_ai'")
      .all()
    db.close()

    expect(tables).toEqual([])
    expect(triggers).toEqual([])

    await storage.close()
  })

  it('should handle NULL vectors gracefully', async () => {
    deleteDbFiles(MIGRATION_DB_PATH)
    seedLegacyDb([
      {
        id: 'null-vec',
        timestamp: 1000,
        text: 'no vector',
        summary: 'test',
        appName: 'App',
        vector: null,
      },
    ])

    const storage = new StorageService(MIGRATION_DB_PATH)
    await storage.init()

    const rows = await storage.getActivitiesByIds(['null-vec'])
    expect(rows.length).toBe(1)
    expect(rows[0].vector).toEqual([])

    // Vector search should return no results (no vector was inserted)
    const vecResults = await storage.searchActivitiesVectors(v(1.0), 10)
    expect(vecResults).toEqual([])

    await storage.close()
  })

  it('should be idempotent (safe to run init() twice)', async () => {
    deleteDbFiles(MIGRATION_DB_PATH)
    seedLegacyDb([
      {
        id: 'idem-1',
        timestamp: 1000,
        text: 'test',
        summary: 'test',
        appName: 'App',
        vector: v(0.1, 0.2, 0.3),
      },
    ])

    const storage1 = new StorageService(MIGRATION_DB_PATH)
    await storage1.init()
    await storage1.close()

    // Second init on same DB — context_events already dropped, should not throw
    const storage2 = new StorageService(MIGRATION_DB_PATH)
    await storage2.init()

    const rows = await storage2.getActivitiesByIds(['idem-1'])
    expect(rows.length).toBe(1)

    await storage2.close()
  })

  it('should drop empty legacy table without error', async () => {
    deleteDbFiles(MIGRATION_DB_PATH)
    seedLegacyDb([]) // empty table

    const storage = new StorageService(MIGRATION_DB_PATH)
    await storage.init()

    const db = new Database(MIGRATION_DB_PATH)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'context_events%'")
      .all()
    db.close()

    expect(tables).toEqual([])

    await storage.close()
  })

  it('should skip migration on fresh database (no legacy table)', async () => {
    deleteDbFiles(MIGRATION_DB_PATH)

    const storage = new StorageService(MIGRATION_DB_PATH)
    // Should not throw — no context_events table to migrate
    await storage.init()

    const count = await storage.countRows()
    expect(count).toBe(0)

    await storage.close()
  })
})

// ---------------------------------------------------------------------------
// Migration system
// ---------------------------------------------------------------------------

const SYSTEM_DB_PATH = path.join(process.cwd(), 'temp_migration_system_test.db')

describe('migration system', () => {
  afterEach(() => {
    deleteDbFiles(SYSTEM_DB_PATH)
  })

  it('should apply all 2 migrations on a fresh database', async () => {
    deleteDbFiles(SYSTEM_DB_PATH)

    const storage = new StorageService(SYSTEM_DB_PATH)
    await storage.init()
    await storage.close()

    const db = new Database(SYSTEM_DB_PATH)
    const rows = db.prepare('SELECT name FROM schema_migrations ORDER BY id').all() as {
      name: string
    }[]
    db.close()

    expect(rows.length).toBe(2)
    expect(rows[0].name).toBe('0001_initial_schema')
    expect(rows[1].name).toBe('0002_migrate_context_events')
  })

  it('should not re-apply migrations on second init', async () => {
    deleteDbFiles(SYSTEM_DB_PATH)

    const storage1 = new StorageService(SYSTEM_DB_PATH)
    await storage1.init()
    await storage1.close()

    const storage2 = new StorageService(SYSTEM_DB_PATH)
    await storage2.init()
    await storage2.close()

    const db = new Database(SYSTEM_DB_PATH)
    const rows = db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]
    db.close()

    // Still exactly 2 rows — no duplicates
    expect(rows.length).toBe(2)
  })

  it('getMigrationStatus returns correct applied state after init', async () => {
    deleteDbFiles(SYSTEM_DB_PATH)

    const storage = new StorageService(SYSTEM_DB_PATH)
    await storage.init()
    await storage.close()

    const db = new Database(SYSTEM_DB_PATH)
    const status = getMigrationStatus(db)
    db.close()

    expect(status.length).toBe(2)
    for (const s of status) {
      expect(s.applied).toBe(true)
      expect(s.appliedAt).toBeGreaterThan(0)
    }
  })

  it('getMigrationStatus reports unapplied migrations on empty schema_migrations', async () => {
    deleteDbFiles(SYSTEM_DB_PATH)

    const db = new Database(SYSTEM_DB_PATH)
    ensureMigrationsTable(db)
    const status = getMigrationStatus(db)
    db.close()

    expect(status.length).toBe(2)
    for (const s of status) {
      expect(s.applied).toBe(false)
      expect(s.appliedAt).toBeNull()
    }
  })

  it('should apply pending migrations on a partially-migrated database', async () => {
    deleteDbFiles(SYSTEM_DB_PATH)

    // Manually apply only migration 0001 and record it, leaving 0002 pending
    const rawDb = new Database(SYSTEM_DB_PATH)
    sqliteVec.load(rawDb)
    ensureMigrationsTable(rawDb)
    migration0001.up(rawDb)
    rawDb
      .prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')
      .run('0001_initial_schema', Date.now())

    // Seed a legacy context_events row so 0002 has something to migrate
    rawDb.exec(`
      CREATE TABLE context_events (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        appName TEXT NOT NULL DEFAULT '',
        vector BLOB
      )
    `)
    rawDb.exec(`
      CREATE VIRTUAL TABLE context_events_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding float[384]
      )
    `)
    const blob = Buffer.from(new Float32Array(v(0.1, 0.2, 0.3)).buffer)
    rawDb
      .prepare(
        'INSERT INTO context_events (id, timestamp, text, summary, appName, vector) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('partial-1', 5000, 'ocr', 'summary', 'App', blob)
    rawDb
      .prepare('INSERT INTO context_events_vec (id, embedding) VALUES (?, ?)')
      .run('partial-1', blob)
    rawDb.close()

    // StorageService.init() should apply only the pending migration 0002
    const storage = new StorageService(SYSTEM_DB_PATH)
    await storage.init()
    await storage.close()

    const db = new Database(SYSTEM_DB_PATH)
    const migrationRows = db.prepare('SELECT name FROM schema_migrations ORDER BY id').all() as {
      name: string
    }[]
    const activityCount = (
      db.prepare('SELECT COUNT(*) as count FROM activities').get() as { count: number }
    ).count
    db.close()

    expect(migrationRows.length).toBe(2)
    expect(migrationRows[1].name).toBe('0002_migrate_context_events')
    expect(activityCount).toBe(1)
  })

  it('should migrate legacy data and record all migrations', async () => {
    deleteDbFiles(SYSTEM_DB_PATH)
    // Seed a legacy DB at SYSTEM_DB_PATH
    const legacyDb = new Database(SYSTEM_DB_PATH)
    sqliteVec.load(legacyDb)
    legacyDb.exec(`
      CREATE TABLE context_events (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        appName TEXT NOT NULL DEFAULT '',
        vector BLOB
      )
    `)
    legacyDb.exec(`
      CREATE VIRTUAL TABLE context_events_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding float[384]
      )
    `)
    const vectorBlob = Buffer.from(new Float32Array(v(0.5, 0.5)).buffer)
    legacyDb
      .prepare(
        'INSERT INTO context_events (id, timestamp, text, summary, appName, vector) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('sys-1', 9000, 'ocr text', 'summary here', 'App', vectorBlob)
    legacyDb
      .prepare('INSERT INTO context_events_vec (id, embedding) VALUES (?, ?)')
      .run('sys-1', vectorBlob)
    legacyDb.close()

    const storage = new StorageService(SYSTEM_DB_PATH)
    await storage.init()

    const rows = await storage.getActivitiesByIds(['sys-1'])
    expect(rows.length).toBe(1)
    expect(rows[0].summary).toBe('summary here')

    await storage.close()

    const db = new Database(SYSTEM_DB_PATH)
    const migrationRows = db.prepare('SELECT name FROM schema_migrations ORDER BY id').all() as {
      name: string
    }[]
    db.close()

    expect(migrationRows.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Migration idempotency — tests each migration's up() SQL directly
// ---------------------------------------------------------------------------

/** Minimal DB that mirrors what StorageService.init() sets up before migrations. */
function makeMigrationDb(): Database.Database {
  const db = new Database(':memory:')
  sqliteVec.load(db)
  ensureMigrationsTable(db)
  return db
}

describe('migration idempotency', () => {
  it('migration 0001 up() does not throw when called twice', () => {
    const db = makeMigrationDb()
    expect(() => {
      migration0001.up(db)
      migration0001.up(db)
    }).not.toThrow()
    db.close()
  })

  it('migration 0001 up() creates each schema object exactly once', () => {
    const db = makeMigrationDb()
    migration0001.up(db)
    migration0001.up(db)

    const count = (name: string, type: string) =>
      (
        db
          .prepare(`SELECT COUNT(*) as n FROM sqlite_master WHERE type=? AND name=?`)
          .get(type, name) as { n: number }
      ).n

    expect(count('activities', 'table')).toBe(1)
    expect(count('activities_fts', 'table')).toBe(1)
    expect(count('activities_vec', 'table')).toBe(1)
    expect(count('activities_ai', 'trigger')).toBe(1)
    expect(count('idx_activities_start_timestamp', 'index')).toBe(1)
    expect(count('idx_activities_app_name', 'index')).toBe(1)
    db.close()
  })

  it('migration 0002 up() does not throw when no context_events table exists', () => {
    const db = makeMigrationDb()
    migration0001.up(db)
    expect(() => {
      migration0002.up(db)
      migration0002.up(db)
    }).not.toThrow()
    db.close()
  })

  it('migration 0002 up() second call is no-op after context_events is dropped', () => {
    const db = makeMigrationDb()
    migration0001.up(db)

    db.exec(`
      CREATE TABLE context_events (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        appName TEXT NOT NULL DEFAULT '',
        vector BLOB
      )
    `)
    db.exec(`
      CREATE VIRTUAL TABLE context_events_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding float[384]
      )
    `)
    const blob = Buffer.from(new Float32Array(v(0.1, 0.2, 0.3)).buffer)
    db.prepare(
      'INSERT INTO context_events (id, timestamp, text, summary, appName, vector) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('idem-x', 1000, 'text', 'sum', 'App', blob)
    db.prepare('INSERT INTO context_events_vec (id, embedding) VALUES (?, ?)').run('idem-x', blob)

    migration0002.up(db) // migrates row, drops context_events

    const countAfterFirst = (
      db.prepare('SELECT COUNT(*) as count FROM activities').get() as { count: number }
    ).count
    expect(countAfterFirst).toBe(1)

    // Second call: context_events is gone — must be a no-op, not an error
    expect(() => migration0002.up(db)).not.toThrow()

    const countAfterSecond = (
      db.prepare('SELECT COUNT(*) as count FROM activities').get() as { count: number }
    ).count
    expect(countAfterSecond).toBe(1) // row count unchanged
    db.close()
  })

  it('runMigrations called twice records each migration exactly once', () => {
    const db = makeMigrationDb()
    runMigrations(db)
    runMigrations(db)

    const rows = db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]
    expect(rows.length).toBe(2)
    db.close()
  })
})
