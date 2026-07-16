import Database from 'better-sqlite3'
import type { Migration } from '../migrator'

/**
 * Per-day task-mining ledger, replacing the single-column `mining_runs` gate.
 * Each local calendar day is a job row: enqueued as `pending`, claimed as
 * `running`, and finished as `completed` or (after exhausting attempts)
 * `failed`. The sweep in TaskMiner drives the state machine; this migration
 * only creates the table and preserves prior mining history.
 *
 * Seeding: a DB that has already been mined (non-empty `mining_runs`) gets
 * `completed` rows for every day of the mining window that predates its last
 * run, so upgrading never re-mines history. Days between the last run and
 * yesterday are left absent — the runtime gap-fill enqueues them as `pending`.
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
    `)

    const row = db.prepare('SELECT MAX(ran_at) AS latest FROM mining_runs').get() as {
      latest: number | null
    }
    if (row.latest !== null) {
      const localDay = (d: Date): string =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const lastRunDay = localDay(new Date(row.latest))
      const now = Date.now()
      const today = new Date()
      const insert = db.prepare(
        `INSERT INTO mining_days (day, status, attempts, enqueued_at, completed_at, stats)
         VALUES (?, 'completed', 0, ?, ?, '{"seeded":true}')`,
      )
      // 60-day window (the backfill depth when this migration shipped): a run
      // on day X mined everything before X, so those days are settled.
      for (let back = 60; back >= 1; back--) {
        const day = localDay(
          new Date(today.getFullYear(), today.getMonth(), today.getDate() - back),
        )
        if (day < lastRunDay) insert.run(day, now, now)
      }
    }

    db.exec('DROP TABLE mining_runs')
  },
}
