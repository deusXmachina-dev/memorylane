import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * Drops the redundant `activities.vector` BLOB. The embedding is already stored
 * in the `activities_vec` vec0 table (the searchable copy), which can also
 * return the raw vector via `SELECT embedding ... WHERE id = ?`. Nothing reads
 * the standalone blob anymore.
 */
export const migration: Migration = {
  name: '0014_drop_activities_vector',
  up(db: Database.Database): void {
    db.exec(`ALTER TABLE activities DROP COLUMN vector`)
  },
}
