import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * Add the `steps` column to sightings: the run's happy-path steps as a JSON
 * string array in "App identity: action" format, written by the miner at scan
 * time. Pre-existing sightings keep '[]'.
 */
export const migration: Migration = {
  name: '0017_sighting_steps',
  up(db: Database.Database): void {
    db.exec(`ALTER TABLE sightings ADD COLUMN steps TEXT NOT NULL DEFAULT '[]'`)
  },
}
