import type Database from 'better-sqlite3'

/** Incremental-mining cursor: records when each run happened so the next run
 *  knows where to resume. Only the latest timestamp is ever read back. */
export class MiningRunRepository {
  constructor(private readonly db: Database.Database) {}

  record(ranAt: number = Date.now()): void {
    this.db.prepare('INSERT INTO mining_runs (ran_at) VALUES (?)').run(ranAt)
  }

  getLastRunTimestamp(): number | null {
    const row = this.db.prepare('SELECT MAX(ran_at) AS latest FROM mining_runs').get() as {
      latest: number | null
    }
    return row.latest ?? null
  }
}
