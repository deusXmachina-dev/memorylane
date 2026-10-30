import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

export const migration: Migration = {
  name: '0025_embedding_state',
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE embedding_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        activity_model TEXT NOT NULL,
        activity_cursor INTEGER NOT NULL DEFAULT 0,
        signature_model TEXT NOT NULL
      );
      INSERT INTO embedding_state (id, activity_model, signature_model)
      VALUES (1, 'Xenova/all-MiniLM-L6-v2', 'Xenova/all-MiniLM-L6-v2');
    `)
  },
}
