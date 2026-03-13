import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

export const migration: Migration = {
  name: '0008_pattern_detection_runs',
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE pattern_detection_runs (
        id TEXT PRIMARY KEY,
        ran_at INTEGER NOT NULL,
        findings_count INTEGER NOT NULL DEFAULT 0
      )
    `)
  },
}
