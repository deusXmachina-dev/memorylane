import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

export const migration: Migration = {
  name: '0025_activities_end_timestamp_index',
  up(db: Database.Database): void {
    db.exec('CREATE INDEX idx_activities_end_timestamp ON activities(end_timestamp)')
  },
}
