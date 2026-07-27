import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * One-off: drop every terminally `failed` mining day. These days exhausted
 * their attempts against a request deadline shorter than a scan of a full day
 * takes, so the failure was the deadline's, not the day's. Deleting rather
 * than reopening means `ensureEnqueued` re-adds only the days still inside the
 * backfill window, each with a fresh attempt budget.
 */
export const migration: Migration = {
  name: '0019_reset_failed_mining_days',
  up(db: Database.Database): void {
    db.exec(`DELETE FROM mining_days WHERE status = 'failed'`)
  },
}
