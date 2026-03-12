import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

export const migration: Migration = {
  name: '0005_pattern_status_columns',
  up(db: Database.Database): void {
    db.exec(`ALTER TABLE patterns ADD COLUMN rejected_at INTEGER`)
    db.exec(`ALTER TABLE patterns ADD COLUMN prompt_copied_at INTEGER`)
  },
}
