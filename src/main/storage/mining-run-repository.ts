import type Database from 'better-sqlite3'

/** Provenance for mining runs (parallels the legacy pattern_detection_runs). */
export class MiningRunRepository {
  constructor(private readonly db: Database.Database) {}

  record(runId: string, sightingsCount: number, ranAt: number = Date.now()): void {
    this.db
      .prepare('INSERT INTO mining_runs (id, ran_at, sightings_count) VALUES (?, ?, ?)')
      .run(runId, ranAt, sightingsCount)
  }

  getLastRunTimestamp(): number | null {
    const row = this.db.prepare('SELECT MAX(ran_at) AS latest FROM mining_runs').get() as {
      latest: number | null
    }
    return row.latest ?? null
  }
}
