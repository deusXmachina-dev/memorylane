import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * Inverts pattern detection: a "sighting" (a single task instance) becomes the
 * source of truth, mined append-only from activities. "Clusters" (process
 * candidates) are a derived, re-computable view grouped on top of sightings.
 *
 * Additive only — the legacy `patterns` / `pattern_sightings` /
 * `pattern_detection_runs` tables are left in place and removed by a later
 * migration once the new pipeline is validated.
 */
export const migration: Migration = {
  name: '0012_add_tasks_tables',
  up(db: Database.Database): void {
    // Carved in stone: one row per task instance. Append-only; the clusterer
    // never writes here. `activity_ids` is explicit membership (not a range) so
    // an interruption mid-episode can be excluded — it is the verifiable recall
    // handle and anti-bundling guard. title/description are the distillation;
    // activity_ids are the proof. interaction_min is the only duration stored
    // (wall-clock span = ended_at - started_at, derived on read).
    db.exec(`
      CREATE TABLE sightings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        apps TEXT NOT NULL DEFAULT '[]',
        activity_ids TEXT NOT NULL DEFAULT '[]',
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        interaction_min REAL NOT NULL,
        confidence REAL NOT NULL DEFAULT 0,
        vector BLOB,
        run_id TEXT NOT NULL,
        detected_at INTEGER NOT NULL
      )
    `)
    db.exec(`CREATE INDEX idx_sightings_started_at ON sightings(started_at)`)
    db.exec(`CREATE INDEX idx_sightings_run_id ON sightings(run_id)`)

    // Derived, rebuilt idempotently on every clustering run. Only multi-member
    // clusters are persisted; singletons (noise) are not written. Stats are
    // denormalized at build time for fast reads.
    db.exec(`
      CREATE TABLE clusters (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        apps TEXT NOT NULL DEFAULT '[]',
        sighting_count INTEGER NOT NULL,
        distinct_days INTEGER NOT NULL,
        total_interaction_min REAL NOT NULL,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        per_week REAL,
        medoid_sighting_id TEXT NOT NULL,
        computed_at INTEGER NOT NULL,
        run_id TEXT NOT NULL
      )
    `)

    db.exec(`
      CREATE TABLE cluster_members (
        cluster_id TEXT NOT NULL REFERENCES clusters(id),
        sighting_id TEXT NOT NULL REFERENCES sightings(id),
        PRIMARY KEY (cluster_id, sighting_id)
      )
    `)
    db.exec(`CREATE INDEX idx_cluster_members_sighting ON cluster_members(sighting_id)`)

    // Provenance for mining runs (parallels the legacy pattern_detection_runs).
    db.exec(`
      CREATE TABLE mining_runs (
        id TEXT PRIMARY KEY,
        ran_at INTEGER NOT NULL,
        sightings_count INTEGER NOT NULL
      )
    `)
  },
}
