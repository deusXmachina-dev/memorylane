import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

export const migration: Migration = {
  name: '0009_pattern_duration_estimate',
  up(db: Database.Database): void {
    db.exec(`ALTER TABLE pattern_sightings ADD COLUMN duration_estimate_min REAL`)
  },
}
