import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/** Add `last_error_status` to mining_days: the HTTP status of the last failed attempt, if any. */
export const migration: Migration = {
  name: '0025_mining_day_error_status',
  up(db: Database.Database): void {
    db.exec(`ALTER TABLE mining_days ADD COLUMN last_error_status INTEGER`)
  },
}
