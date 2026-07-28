import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * Moves the cluster tables from the module-owned `cluster-schema.ts` mechanism
 * (CLUSTER_SCHEMA_VERSION drop-and-recreate, tracked in `cluster_meta`) into
 * the migration system. DBs already at cluster-schema v5 keep their data minus
 * the dropped columns (`kind`, `label_model`, `updated_at`, `computed_at`,
 * `added_at`); older or partial states are dropped empty — the same wipe the
 * old mechanism would have performed — and rebuildClustersIfEmpty repopulates
 * on next launch. Future changes that invalidate clusters are explicit wipe
 * migrations (DELETE the derived rows).
 *
 * Labeled clusters whose classification was still pending (`kind = ''`) would
 * otherwise read as judged-not-automatable under the new model — their
 * labeled_size is reset to 0 so the content round re-judges them.
 */

const TABLES = ['clusters', 'cluster_sightings', 'sighting_signatures', 'cluster_merge_declines']

function tableExists(db: Database.Database, name: string): boolean {
  return (
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !==
    undefined
  )
}

export const migration: Migration = {
  name: '0020_cluster_tables',
  up(db: Database.Database): void {
    const version = tableExists(db, 'cluster_meta')
      ? Number(
          (
            db.prepare(`SELECT value FROM cluster_meta WHERE key = 'schema_version'`).get() as
              | { value: string }
              | undefined
          )?.value ?? 0,
        )
      : 0
    const copy = version === 5 && TABLES.every((t) => tableExists(db, t))

    if (copy) {
      db.exec(TABLES.map((t) => `ALTER TABLE ${t} RENAME TO ${t}_old;`).join('\n'))
    } else {
      db.exec(TABLES.map((t) => `DROP TABLE IF EXISTS ${t};`).join('\n'))
    }

    // label = '' means not yet LLM-labeled (readers fall back to member
    // titles); mechanism = '' on a labeled cluster means judged not
    // automatable. labeled_size is the member count at the last labeling,
    // used to trigger a relabel once a cluster doubles.
    db.exec(`
      CREATE TABLE clusters (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        centroid BLOB,
        labeled_size INTEGER NOT NULL DEFAULT 0,
        mechanism TEXT NOT NULL DEFAULT '',
        steps TEXT NOT NULL DEFAULT '[]',
        variables TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE cluster_sightings (
        sighting_id TEXT PRIMARY KEY,
        cluster_id TEXT NOT NULL
      );
      CREATE TABLE sighting_signatures (
        sighting_id TEXT PRIMARY KEY,
        embedding BLOB
      );
      CREATE TABLE cluster_merge_declines (
        cluster_a TEXT NOT NULL,
        cluster_b TEXT NOT NULL,
        declined_at INTEGER NOT NULL,
        PRIMARY KEY (cluster_a, cluster_b)
      );
    `)

    if (copy) {
      db.exec(`
        INSERT INTO clusters (id, label, description, centroid, labeled_size, mechanism, steps, variables, created_at)
          SELECT id, label, description, centroid,
                 CASE WHEN kind = '' AND label != '' THEN 0 ELSE labeled_size END,
                 mechanism, steps, variables, created_at FROM clusters_old;
        INSERT INTO cluster_sightings (sighting_id, cluster_id)
          SELECT sighting_id, cluster_id FROM cluster_sightings_old;
        INSERT INTO sighting_signatures (sighting_id, embedding)
          SELECT sighting_id, embedding FROM sighting_signatures_old;
        INSERT INTO cluster_merge_declines (cluster_a, cluster_b, declined_at)
          SELECT cluster_a, cluster_b, declined_at FROM cluster_merge_declines_old;
      `)
      db.exec(TABLES.map((t) => `DROP TABLE ${t}_old;`).join('\n'))
    }

    db.exec(`
      CREATE INDEX idx_cluster_sightings_cluster ON cluster_sightings(cluster_id);
      DROP TABLE IF EXISTS cluster_meta;
    `)
  },
}
