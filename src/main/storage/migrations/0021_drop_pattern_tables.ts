import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * Drops the legacy pattern-detection tables. The pipeline they served was
 * replaced by task mining (0012) and its UI/detector were removed in the
 * clusters cutover; nothing reads or writes these tables anymore.
 */
export const migration: Migration = {
  name: '0021_drop_pattern_tables',
  up(db: Database.Database): void {
    db.exec(`
      DROP TABLE IF EXISTS pattern_sightings;
      DROP TABLE IF EXISTS patterns;
      DROP TABLE IF EXISTS pattern_detection_runs;
    `)
  },
}
