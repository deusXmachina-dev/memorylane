import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * Cluster-level classification written by the review LLM call. kind = '' means
 * not yet judged (existing clusters drain through review over the next runs).
 * mechanism is the consolidated "Replace with" recommendation; only clusters
 * classified as 'procedure' carry one.
 */
export const migration: Migration = {
  name: '0016_add_cluster_verdict',
  up(db: Database.Database): void {
    db.exec(`ALTER TABLE clusters ADD COLUMN kind TEXT NOT NULL DEFAULT ''`)
    db.exec(`ALTER TABLE clusters ADD COLUMN mechanism_kind TEXT NOT NULL DEFAULT ''`)
    db.exec(`ALTER TABLE clusters ADD COLUMN mechanism TEXT NOT NULL DEFAULT ''`)
  },
}
