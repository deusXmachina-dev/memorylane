import Database from 'better-sqlite3'
import log from '@main/utils/logger'

/**
 * Cluster tables hold state DERIVED from the append-only `sightings` table and
 * are fully rebuildable (rebuildClustersIfEmpty repopulates after a wipe), so
 * they live outside the migration system: bump this version on any schema or
 * embedding-geometry change and the tables are dropped and recreated on the
 * next launch. Version 2 = title+description signature embeddings with
 * average-linkage grouping. Version 3 = recipe columns (steps, variables).
 * Version 4 = "App (domain): action" recipe step format; the wipe forces a
 * relabel so clusters labeled before recipes existed finally get steps.
 */
export const CLUSTER_SCHEMA_VERSION = 4

export function ensureClusterSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cluster_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  const row = db.prepare(`SELECT value FROM cluster_meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined
  const stored = row ? Number(row.value) : 0
  if (stored === CLUSTER_SCHEMA_VERSION) return

  log.info(
    `Cluster schema version ${stored} -> ${CLUSTER_SCHEMA_VERSION}: rebuilding derived cluster tables`,
  )
  db.transaction(() => {
    db.exec(`
      DROP TABLE IF EXISTS cluster_sightings;
      DROP TABLE IF EXISTS clusters;
      DROP TABLE IF EXISTS sighting_signatures;
      DROP TABLE IF EXISTS cluster_merge_declines;
    `)

    // A row means "this sighting has been processed by the clusterer".
    // NULL embedding = no usable text to embed (permanent singleton).
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
    // kind = '' means not yet judged by the review LLM; mechanism is the
    // consolidated "Replace with" recommendation ('procedure' clusters only).
    // steps/variables are the generalized, de-identified recipe (JSON arrays);
    // '[]' until the review LLM fills them in.
    db.exec(`
      CREATE TABLE clusters (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        centroid BLOB,
        label_model TEXT NOT NULL DEFAULT '',
        labeled_size INTEGER NOT NULL DEFAULT 0,
        kind TEXT NOT NULL DEFAULT '',
        mechanism TEXT NOT NULL DEFAULT '',
        steps TEXT NOT NULL DEFAULT '[]',
        variables TEXT NOT NULL DEFAULT '[]',
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

    // Merge pairs the review LLM was shown and did not merge. Without this a
    // declined merge is re-proposed every run while an accepted one is
    // permanent, so any borderline pair eventually merges. Declines expire by
    // age (MERGE_DECLINE_TTL_MS) so cluster growth can reopen the question.
    db.exec(`
      CREATE TABLE cluster_merge_declines (
        cluster_a TEXT NOT NULL,
        cluster_b TEXT NOT NULL,
        declined_at INTEGER NOT NULL,
        PRIMARY KEY (cluster_a, cluster_b)
      )
    `)

    db.prepare(
      `INSERT INTO cluster_meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(String(CLUSTER_SCHEMA_VERSION))
  })()
}
