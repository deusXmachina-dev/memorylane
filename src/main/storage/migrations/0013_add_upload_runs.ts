import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * Tracks successful enterprise database uploads. The only thing read back is
 * MAX(ran_at), which the uploader compares against `now` (via isSameDay) to
 * skip re-uploading more than once a day. Persisting this lets uploads catch up
 * on startup / power-resume instead of relying on a sleep-fragile 24h interval.
 */
export const migration: Migration = {
  name: '0013_add_upload_runs',
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE upload_runs (
        ran_at INTEGER NOT NULL
      )
    `)
  },
}
