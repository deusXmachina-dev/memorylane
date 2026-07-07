import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * Merge pairs the review LLM was shown and did not merge. Without this a
 * declined merge is re-proposed every run while an accepted one is permanent,
 * so any borderline pair eventually merges. Declines expire by age
 * (MERGE_DECLINE_TTL_MS) so cluster growth can reopen the question.
 */
export const migration: Migration = {
  name: '0017_add_cluster_merge_declines',
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE cluster_merge_declines (
        cluster_a TEXT NOT NULL,
        cluster_b TEXT NOT NULL,
        declined_at INTEGER NOT NULL,
        PRIMARY KEY (cluster_a, cluster_b)
      )
    `)
  },
}
