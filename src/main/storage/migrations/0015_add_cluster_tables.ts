import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * Clustering layer over sightings. Everything here is DERIVED from the
 * append-only `sightings` table and rebuildable; sightings stay untouched.
 * Clusters have stable ids across runs — new sightings attach to existing
 * clusters so "seen X times" can grow week over week.
 */
export const migration: Migration = {
  name: '0015_add_cluster_tables',
  up(db: Database.Database): void {
    // A row means "this sighting has been processed by the clusterer".
    // NULL embedding = no usable activity vectors (permanent singleton).
    // Persisted so re-clustering never depends on activities surviving
    // their own pruning schedule.
    db.exec(`
      CREATE TABLE sighting_signatures (
        sighting_id TEXT PRIMARY KEY,
        embedding BLOB,
        computed_at INTEGER NOT NULL
      )
    `)

    // label = '' means not yet LLM-labeled (readers fall back to the most
    // common member title). labeled_size is the member count at the last
    // labeling, used to trigger a relabel once a cluster doubles.
    // centroid is the unit-normalized mean of member signatures.
    db.exec(`
      CREATE TABLE clusters (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        centroid BLOB,
        label_model TEXT NOT NULL DEFAULT '',
        labeled_size INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)

    // A sighting belongs to at most one cluster.
    db.exec(`
      CREATE TABLE cluster_sightings (
        sighting_id TEXT PRIMARY KEY,
        cluster_id TEXT NOT NULL,
        added_at INTEGER NOT NULL
      )
    `)
    db.exec(`CREATE INDEX idx_cluster_sightings_cluster ON cluster_sightings(cluster_id)`)
  },
}
