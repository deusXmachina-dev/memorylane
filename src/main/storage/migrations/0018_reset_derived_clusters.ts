import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * Wipe all derived clustering state so the next mining run re-bootstraps it.
 * Signatures switched from mean-pooled activity embeddings to title+description
 * embeddings and grouping switched from single-linkage to average-linkage —
 * existing signatures/centroids live in the old geometry and existing clusters
 * were built by the linkage rule that produced incoherent mega-clusters.
 * Sightings are untouched; clusters are a rebuildable view (labels return with
 * the next LLM review pass).
 */
export const migration: Migration = {
  name: '0018_reset_derived_clusters',
  up(db: Database.Database): void {
    db.exec(`
      DELETE FROM cluster_sightings;
      DELETE FROM clusters;
      DELETE FROM sighting_signatures;
    `)
  },
}
