import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * Inverts pattern detection: a "sighting" (a single task instance) becomes the
 * source of truth, mined append-only from activities.
 *
 * Additive only — the legacy `patterns` / `pattern_sightings` /
 * `pattern_detection_runs` tables are left in place and removed by a later
 * migration once the new pipeline is validated.
 */
export const migration: Migration = {
  name: '0012_add_tasks_tables',
  up(db: Database.Database): void {
    // Carved in stone: one row per task instance. Append-only. `activity_ids`
    // is explicit membership (not a range) so an interruption mid-episode can
    // be excluded — it is the verifiable recall handle and anti-bundling guard.
    // title/description are the distillation; activity_ids are the proof.
    // interaction_min is the only duration stored (wall-clock span =
    // ended_at - started_at, derived on read).
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
        run_id TEXT NOT NULL,
        detected_at INTEGER NOT NULL
      )
    `)
    db.exec(`CREATE INDEX idx_sightings_started_at ON sightings(started_at)`)
    db.exec(`CREATE INDEX idx_sightings_run_id ON sightings(run_id)`)

    // Cursor for incremental mining: the only thing read back is MAX(ran_at),
    // so the next run knows where to resume. One row per run (including empty
    // runs, so the window still advances when nothing is found).
    db.exec(`
      CREATE TABLE mining_runs (
        ran_at INTEGER NOT NULL
      )
    `)
  },
}
