import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

export const migration: Migration = {
  name: '0011_activities_summary_model_column',
  up(db: Database.Database): void {
    db.exec(`ALTER TABLE activities ADD COLUMN summary_model TEXT NOT NULL DEFAULT ''`)
  },
}
