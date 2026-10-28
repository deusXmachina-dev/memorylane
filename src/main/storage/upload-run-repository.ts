import type Database from 'better-sqlite3'

/** Once-per-day gate for the snapshot tables in enterprise DB uploads. Only
 *  successful snapshot uploads are recorded, so a failure retries next run. */
export class UploadRunRepository {
  constructor(private readonly db: Database.Database) {}

  record(ranAt: number = Date.now()): void {
    this.db.prepare('INSERT INTO upload_runs (ran_at) VALUES (?)').run(ranAt)
  }

  getLastRunTimestamp(): number | null {
    const row = this.db.prepare('SELECT MAX(ran_at) AS latest FROM upload_runs').get() as {
      latest: number | null
    }
    return row.latest ?? null
  }
}
