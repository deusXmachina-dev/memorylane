import Database from 'better-sqlite3'
import log from '@main/utils/logger'
import { migrations } from './migrations'
import { ensureClusterSchema } from './cluster-schema'

export interface Migration {
  name: string
  up: (db: Database.Database) => void
}

export interface MigrationStatus {
  name: string
  applied: boolean
  appliedAt: number | null
}

interface MigrationRow {
  name: string
  applied_at: number
}

export function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `)
}

export function runMigrations(db: Database.Database): void {
  const appliedRows = db.prepare('SELECT name FROM schema_migrations').all() as { name: string }[]
  const applied = new Set(appliedRows.map((r) => r.name))

  let appliedCount = 0
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue

    log.info(`Applying migration: ${migration.name}`)
    db.transaction(() => {
      migration.up(db)
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        Date.now(),
      )
    })()
    log.info(`Migration applied: ${migration.name}`)
    appliedCount++
  }

  if (appliedCount > 0) {
    log.info(`Database schema: applied ${appliedCount} migration(s), now at ${migrations.length}`)
  } else {
    log.debug(`Database schema up to date (${migrations.length} migrations)`)
  }
}

export function applyMigrations(db: Database.Database): void {
  ensureMigrationsTable(db)
  runMigrations(db)
  ensureClusterSchema(db)
}

export function getMigrationStatus(db: Database.Database): MigrationStatus[] {
  const appliedRows = db
    .prepare('SELECT name, applied_at FROM schema_migrations')
    .all() as MigrationRow[]
  const appliedMap = new Map(appliedRows.map((r) => [r.name, r.applied_at]))

  return migrations.map((migration) => ({
    name: migration.name,
    applied: appliedMap.has(migration.name),
    appliedAt: appliedMap.get(migration.name) ?? null,
  }))
}
