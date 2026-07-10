import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * Add the `subject` column to sightings: the instance-specific object a run
 * acted on, split out of the title so a recurring procedure gets one canonical
 * title and differs only in subject. Fresh DBs and DBs that predate this
 * migration both pick it up here; 0012 stays immutable.
 */
export const migration: Migration = {
  name: '0015_sighting_subject_backfill',
  up(db: Database.Database): void {
    db.exec(`ALTER TABLE sightings ADD COLUMN subject TEXT NOT NULL DEFAULT ''`)
  },
}
