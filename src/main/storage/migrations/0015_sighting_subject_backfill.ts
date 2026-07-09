import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * Safety net for the in-place `subject` column added to 0012. A DB that already
 * applied the original 0012 has `subject` recorded as applied, so the edited
 * CREATE TABLE never re-runs and the column is missing — every sightings INSERT
 * would then throw. Add it here when absent; a no-op on fresh DBs where 0012
 * already created it.
 */
export const migration: Migration = {
  name: '0015_sighting_subject_backfill',
  up(db: Database.Database): void {
    const hasSubject = (
      db.prepare(`PRAGMA table_info(sightings)`).all() as { name: string }[]
    ).some((c) => c.name === 'subject')
    if (!hasSubject) {
      db.exec(`ALTER TABLE sightings ADD COLUMN subject TEXT NOT NULL DEFAULT ''`)
    }
  },
}
