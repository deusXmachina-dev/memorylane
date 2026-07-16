import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * Per-day task-mining ledger, replacing the single-column `mining_runs` gate.
 * Each local calendar day is a job row: enqueued as `pending`, claimed as
 * `running`, and finished as `completed` or (after exhausting attempts)
 * `failed`. The sweep in TaskMiner drives the state machine; this migration
 * only creates the table.
 *
 * No seeding from `mining_runs`: the sweep marks days that already have
 * sightings completed without re-mining them, and re-scans the rest — which
 * also heals days the old one-shot bootstrap silently failed on.
 */
export const migration: Migration = {
  name: '0016_add_mining_days',
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE mining_days (
        day          TEXT PRIMARY KEY,
        status       TEXT NOT NULL DEFAULT 'pending',
        attempts     INTEGER NOT NULL DEFAULT 0,
        last_error   TEXT,
        enqueued_at  INTEGER NOT NULL,
        started_at   INTEGER,
        completed_at INTEGER,
        stats        TEXT
      );
      CREATE INDEX idx_mining_days_status ON mining_days(status);
      DROP TABLE mining_runs;
    `)
  },
}
