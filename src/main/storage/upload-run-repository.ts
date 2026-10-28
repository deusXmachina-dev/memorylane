import type Database from 'better-sqlite3'

/** Once-per-day gate for enterprise DB uploads: records when each successful
 *  upload happened. The only thing read back is MAX(ran_at), which the uploader
 *  compares against `now` to skip uploading more than once a day and to catch up
 *  on startup / power-resume. Only successful uploads are recorded, so a failed
 *  upload leaves the gate open and retries on the next wake/startup. */
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
