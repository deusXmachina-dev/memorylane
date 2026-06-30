import Database from 'better-sqlite3'
import log from '@main/utils/logger'
import type { Migration } from '../migrator'

interface CountRow {
  readonly count: number
}

export const migration: Migration = {
  name: '0002_migrate_context_events',
  up(db: Database.Database): void {
    const tableExists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='context_events'")
      .get()
    if (!tableExists) return

    log.info('Migrating legacy context_events data into activities…')

    const rowCount = (db.prepare('SELECT COUNT(*) as count FROM context_events').get() as CountRow)
      .count

    if (rowCount > 0) {
      db.transaction(() => {
        db.prepare(
          `INSERT OR IGNORE INTO activities
             (id, start_timestamp, end_timestamp, app_name, window_title, tld, summary, ocr_text, vector)
           SELECT id, timestamp, timestamp, appName, '', NULL, summary, text, vector
           FROM context_events`,
        ).run()

        db.prepare(
          `INSERT OR IGNORE INTO activities_vec (id, embedding)
           SELECT id, vector FROM context_events WHERE vector IS NOT NULL`,
        ).run()
      })()
    }

    const drops = [
      'DROP TRIGGER IF EXISTS context_events_ai',
      'DROP TABLE IF EXISTS context_events_fts',
      'DROP TABLE IF EXISTS context_events_vec',
      'DROP INDEX IF EXISTS idx_context_events_timestamp',
      'DROP INDEX IF EXISTS idx_context_events_appName',
      'DROP TABLE IF EXISTS context_events',
    ]
    for (const sql of drops) {
      db.exec(sql)
    }

    log.info(`Migrated ${rowCount} legacy context_events rows and dropped legacy tables`)
  },
}
