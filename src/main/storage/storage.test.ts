import { describe, it, expect, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { StorageService } from './index'
import {
  applyMigrations,
  getMigrationStatus,
  ensureMigrationsTable,
  runMigrations,
} from './migrator'
import { migration as migration0001 } from './migrations/0001_initial_schema'
import { migration as migration0002 } from './migrations/0002_migrate_context_events'
import { migration as migration0003 } from './migrations/0003_fts_sync_triggers'
import * as path from 'path'
import { v, deleteDbFiles } from './test-utils'

// ---------------------------------------------------------------------------
// StorageService lifecycle and metadata
// ---------------------------------------------------------------------------

const TEST_DB_PATH = path.join(process.cwd(), 'temp_storage_test.db')
const BACKUP_DB_PATH = path.join(process.cwd(), 'temp_storage_backup_test.db')

describe('StorageService', () => {
  let storage: StorageService

  afterEach(() => {
    storage?.close()
    deleteDbFiles(TEST_DB_PATH)
    deleteDbFiles(BACKUP_DB_PATH)
  })

  describe('getDbPath and getDbSize', () => {
    it('should return the configured database path', () => {
      storage = new StorageService(TEST_DB_PATH)
      applyMigrations(storage.getDatabase())
      expect(storage.getDbPath()).toBe(TEST_DB_PATH)
    })

    it('should return a positive size for an initialized database', () => {
      storage = new StorageService(TEST_DB_PATH)
      applyMigrations(storage.getDatabase())
      expect(storage.getDbSize()).toBeGreaterThan(0)
    })

    it('should return 0 after close and file deletion', () => {
      storage = new StorageService(TEST_DB_PATH)
      applyMigrations(storage.getDatabase())
      storage.close()
      deleteDbFiles(TEST_DB_PATH)
      expect(storage.getDbSize()).toBe(0)
    })
  })

  describe('lifecycle', () => {
    it('should allow close() then re-construct', () => {
      storage = new StorageService(TEST_DB_PATH)
      applyMigrations(storage.getDatabase())
      storage.activities.add({
        id: 'life-1',
        startTimestamp: 1000,
        endTimestamp: 2000,
        appName: 'App',
        windowTitle: 'Win',
        tld: null,
        summary: 'test',
        ocrText: 'text',
        vector: v(0.1),
      })
      storage.close()

      const storage2 = new StorageService(TEST_DB_PATH)
      applyMigrations(storage2.getDatabase())
      const results = storage2.activities.getByIds(['life-1'])
      expect(results.length).toBe(1)
      storage2.close()
    })

    it('should handle double close() without error', () => {
      storage = new StorageService(TEST_DB_PATH)
      applyMigrations(storage.getDatabase())
      storage.close()
      expect(() => storage.close()).not.toThrow()
    })

    it('should create a readable backup while database is open', async () => {
      storage = new StorageService(TEST_DB_PATH)
      applyMigrations(storage.getDatabase())
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
  afterEach(() => {
    deleteDbFiles(MIGRATION_DB_PATH)
  })

  it('should migrate rows into activities with correct column mapping', () => {
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
    applyMigrations(storage.getDatabase())
    const rows = storage.activities.getByIds(['evt-1'])
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

    storage.close()
  })

  it('should make migrated rows searchable via FTS', () => {
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
    applyMigrations(storage.getDatabase())
    const results = storage.activities.searchFTS('compiling', 10)
    expect(results.length).toBe(1)
    expect(results[0].id).toBe('fts-evt')

    storage.close()
  })

  it('should make migrated rows searchable via vector similarity', () => {
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
    applyMigrations(storage.getDatabase())
    const results = storage.activities.searchVectors(v(1.0), 10)
    expect(results.length).toBe(1)
    expect(results[0].id).toBe('vec-evt')

    storage.close()
  })

  it('should drop legacy tables after migration', () => {
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
    applyMigrations(storage.getDatabase())
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

    storage.close()
  })

  it('should handle NULL vectors gracefully', () => {
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
    applyMigrations(storage.getDatabase())
    const rows = storage.activities.getByIds(['null-vec'])
    expect(rows.length).toBe(1)
    expect(rows[0].vector).toEqual([])

    // Vector search should return no results (no vector was inserted)
    const vecResults = storage.activities.searchVectors(v(1.0), 10)
    expect(vecResults).toEqual([])

    storage.close()
  })

  it('should be idempotent (safe to run init() twice)', () => {
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
    applyMigrations(storage1.getDatabase())
    storage1.close()

    // Second construction on same DB — context_events already dropped, should not throw
    const storage2 = new StorageService(MIGRATION_DB_PATH)
    applyMigrations(storage2.getDatabase())

    const rows = storage2.activities.getByIds(['idem-1'])
    expect(rows.length).toBe(1)

    storage2.close()
  })

  it('should drop empty legacy table without error', () => {
    deleteDbFiles(MIGRATION_DB_PATH)
    seedLegacyDb([]) // empty table

    const storage = new StorageService(MIGRATION_DB_PATH)
    applyMigrations(storage.getDatabase())
    const db = new Database(MIGRATION_DB_PATH)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'context_events%'")
      .all()
    db.close()

    expect(tables).toEqual([])

    storage.close()
  })

  it('should skip migration on fresh database (no legacy table)', () => {
    deleteDbFiles(MIGRATION_DB_PATH)

    // Should not throw — no context_events table to migrate
    const storage = new StorageService(MIGRATION_DB_PATH)
    applyMigrations(storage.getDatabase())

    const count = storage.activities.count()
    expect(count).toBe(0)

    storage.close()
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

  it('should apply all 3 migrations on a fresh database', () => {
    deleteDbFiles(SYSTEM_DB_PATH)

    const storage = new StorageService(SYSTEM_DB_PATH)
    applyMigrations(storage.getDatabase())
    storage.close()

    const db = new Database(SYSTEM_DB_PATH)
    const rows = db.prepare('SELECT name FROM schema_migrations ORDER BY id').all() as {
      name: string
    }[]
    db.close()

    expect(rows.length).toBe(7)
    expect(rows[0].name).toBe('0001_initial_schema')
    expect(rows[1].name).toBe('0002_migrate_context_events')
    expect(rows[2].name).toBe('0003_fts_sync_triggers')
  })

  it('should not re-apply migrations on second construction', () => {
    deleteDbFiles(SYSTEM_DB_PATH)

    const storage1 = new StorageService(SYSTEM_DB_PATH)
    applyMigrations(storage1.getDatabase())
    storage1.close()

    const storage2 = new StorageService(SYSTEM_DB_PATH)
    applyMigrations(storage2.getDatabase())
    storage2.close()

    const db = new Database(SYSTEM_DB_PATH)
    const rows = db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]
    db.close()

    // Still exactly 3 rows — no duplicates
    expect(rows.length).toBe(7)
  })

  it('getMigrationStatus returns correct applied state after construction', () => {
    deleteDbFiles(SYSTEM_DB_PATH)

    const storage = new StorageService(SYSTEM_DB_PATH)
    applyMigrations(storage.getDatabase())
    storage.close()

    const db = new Database(SYSTEM_DB_PATH)
    const status = getMigrationStatus(db)
    db.close()

    expect(status.length).toBe(7)
    for (const s of status) {
      expect(s.applied).toBe(true)
      expect(s.appliedAt).toBeGreaterThan(0)
    }
  })

  it('getMigrationStatus reports unapplied migrations on empty schema_migrations', () => {
    deleteDbFiles(SYSTEM_DB_PATH)

    const db = new Database(SYSTEM_DB_PATH)
    ensureMigrationsTable(db)
    const status = getMigrationStatus(db)
    db.close()

    expect(status.length).toBe(7)
    for (const s of status) {
      expect(s.applied).toBe(false)
      expect(s.appliedAt).toBeNull()
    }
  })

  it('should apply pending migrations on a partially-migrated database', () => {
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

    // StorageService constructor should apply only the pending migrations 0002 and 0003
    const storage = new StorageService(SYSTEM_DB_PATH)
    applyMigrations(storage.getDatabase())
    storage.close()

    const db = new Database(SYSTEM_DB_PATH)
    const migrationRows = db.prepare('SELECT name FROM schema_migrations ORDER BY id').all() as {
      name: string
    }[]
    const activityCount = (
      db.prepare('SELECT COUNT(*) as count FROM activities').get() as { count: number }
    ).count
    db.close()

    expect(migrationRows.length).toBe(7)
    expect(migrationRows[1].name).toBe('0002_migrate_context_events')
    expect(migrationRows[2].name).toBe('0003_fts_sync_triggers')
    expect(activityCount).toBe(1)
  })

  it('should migrate legacy data and record all migrations', () => {
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
    applyMigrations(storage.getDatabase())

    const rows = storage.activities.getByIds(['sys-1'])
    expect(rows.length).toBe(1)
    expect(rows[0].summary).toBe('summary here')

    storage.close()

    const db = new Database(SYSTEM_DB_PATH)
    const migrationRows = db.prepare('SELECT name FROM schema_migrations ORDER BY id').all() as {
      name: string
    }[]
    db.close()

    expect(migrationRows.length).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// Migration idempotency — tests each migration's up() SQL directly
// ---------------------------------------------------------------------------

/** Minimal DB that mirrors what StorageService constructor sets up before migrations. */
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

  it('migration 0003 up() does not throw when called twice', () => {
    const db = makeMigrationDb()
    migration0001.up(db)
    expect(() => {
      migration0003.up(db)
      migration0003.up(db)
    }).not.toThrow()
    db.close()
  })

  it('migration 0003 up() creates each trigger exactly once', () => {
    const db = makeMigrationDb()
    migration0001.up(db)
    migration0003.up(db)
    migration0003.up(db)

    const count = (name: string) =>
      (
        db
          .prepare(`SELECT COUNT(*) as n FROM sqlite_master WHERE type='trigger' AND name=?`)
          .get(name) as { n: number }
      ).n

    expect(count('activities_ad')).toBe(1)
    expect(count('activities_au')).toBe(1)
    db.close()
  })

  it('runMigrations called twice records each migration exactly once', () => {
    const db = makeMigrationDb()
    runMigrations(db)
    runMigrations(db)

    const rows = db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]
    expect(rows.length).toBe(7)
    db.close()
  })
})
