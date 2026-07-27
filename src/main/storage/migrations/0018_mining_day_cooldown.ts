import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * Add `next_attempt_at` to mining_days: a per-day retry cooldown. NULL means
 * claimable now; a timestamp keeps the pending row unclaimable until then.
 */
export const migration: Migration = {
  name: '0018_mining_day_cooldown',
  up(db: Database.Database): void {
    db.exec(`ALTER TABLE mining_days ADD COLUMN next_attempt_at INTEGER`)
  },
}
