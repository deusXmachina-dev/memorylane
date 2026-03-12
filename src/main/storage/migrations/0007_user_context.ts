import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

export const migration: Migration = {
  name: '0005_user_context',
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE user_context (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        short_summary TEXT NOT NULL DEFAULT '',
        detailed_summary TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      )
    `)
  },
}
