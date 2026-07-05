import type Database from 'better-sqlite3'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single task instance mined from activities. Carved in stone: append-only.
 * `activityIds` is explicit membership (the verifiable recall handle);
 * `interactionMin` is the summed on-task time of those activities (wall-clock
 * span is `endedAt - startedAt`, derived on read).
 */
export interface Sighting {
  id: string
  title: string
  description: string
  apps: string[]
  activityIds: string[]
  startedAt: number
  endedAt: number
  interactionMin: number
  runId: string
  detectedAt: number
}

export class SightingRepository {
  constructor(private readonly db: Database.Database) {}

  /** Insert a mined sighting. */
  add(sighting: Sighting): void {
    this.db
      .prepare(
        `INSERT INTO sightings
           (id, title, description, apps, activity_ids, started_at, ended_at, interaction_min, run_id, detected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sighting.id,
        sighting.title,
        sighting.description,
        JSON.stringify(sighting.apps),
        JSON.stringify(sighting.activityIds),
        sighting.startedAt,
        sighting.endedAt,
        sighting.interactionMin,
        sighting.runId,
        sighting.detectedAt,
      )
  }

  getById(id: string): Sighting | null {
    const row = this.db.prepare(`SELECT * FROM sightings WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined
    return row ? this.rowToSighting(row) : null
  }

  getByIds(ids: readonly string[]): Sighting[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(', ')
    const rows = this.db
      .prepare(`SELECT * FROM sightings WHERE id IN (${placeholders})`)
      .all(...ids) as Record<string, unknown>[]
    return rows.map((r) => this.rowToSighting(r))
  }

  getByRunId(runId: string): Sighting[] {
    const rows = this.db
      .prepare(`SELECT * FROM sightings WHERE run_id = ? ORDER BY started_at ASC`)
      .all(runId) as Record<string, unknown>[]
    return rows.map((r) => this.rowToSighting(r))
  }

  getAll(): Sighting[] {
    const rows = this.db
      .prepare(`SELECT * FROM sightings ORDER BY started_at DESC`)
      .all() as Record<string, unknown>[]
    return rows.map((r) => this.rowToSighting(r))
  }

  search(query: string): Sighting[] {
    const like = `%${query}%`
    const rows = this.db
      .prepare(
        `SELECT * FROM sightings
         WHERE title LIKE ? OR description LIKE ? OR apps LIKE ?
         ORDER BY started_at DESC`,
      )
      .all(like, like, like) as Record<string, unknown>[]
    return rows.map((r) => this.rowToSighting(r))
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM sightings').get() as {
      count: number
    }
    return row.count
  }

  /**
   * True if any sighting started within the inclusive window `[start, end]`
   * (the boundaries returned by `getDayBoundaries`). Used by the one-time
   * backfill to skip days that have already been mined, so it stays idempotent
   * and resumes cheaply after an interruption.
   */
  hasInWindow(start: number, end: number): boolean {
    return (
      this.db
        .prepare('SELECT 1 FROM sightings WHERE started_at >= ? AND started_at <= ? LIMIT 1')
        .get(start, end) !== undefined
    )
  }

  /** Delete sightings older than `maxAgeDays` (DB hygiene). */
  pruneOlderThan(maxAgeDays = 90, now: number = Date.now()): number {
    const cutoff = now - maxAgeDays * 86_400_000
    return this.db.prepare('DELETE FROM sightings WHERE detected_at < ?').run(cutoff).changes
  }

  private rowToSighting(row: Record<string, unknown>): Sighting {
    return {
      id: row.id as string,
      title: row.title as string,
      description: row.description as string,
      apps: JSON.parse((row.apps as string) || '[]') as string[],
      activityIds: JSON.parse((row.activity_ids as string) || '[]') as string[],
      startedAt: row.started_at as number,
      endedAt: row.ended_at as number,
      interactionMin: row.interaction_min as number,
      runId: row.run_id as string,
      detectedAt: row.detected_at as number,
    }
  }
}
