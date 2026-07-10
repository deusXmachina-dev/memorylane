import type Database from 'better-sqlite3'

/** Once-per-day gate: records when each run happened. The only thing read back
 *  is MAX(ran_at), which the scheduler compares against `now` to skip running
 *  more than once a day. Empty runs are recorded too, so the gate still trips. */
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

  /** Clear the once-per-day gate so the next run isn't skipped as "already ran today". */
  reset(): void {
    this.db.prepare('DELETE FROM mining_runs').run()
  }
}
