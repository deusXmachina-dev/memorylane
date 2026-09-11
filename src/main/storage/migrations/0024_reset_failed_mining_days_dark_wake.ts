import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/** One-off: drop `failed` days, whose attempts overnight dark wakes burned offline. */
export const migration: Migration = {
  name: '0024_reset_failed_mining_days_dark_wake',
  up(db: Database.Database): void {
    db.exec(`DELETE FROM mining_days WHERE status = 'failed'`)
  },
}
