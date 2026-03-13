import type Database from 'better-sqlite3'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Pattern {
  id: string
  name: string
  description: string
  apps: string[] // JSON array in DB
  automationIdea: string
  createdAt: number
  rejectedAt: number | null
  promptCopiedAt: number | null
  approvedAt: number | null
}

export interface PatternSighting {
  id: string
  patternId: string
  detectedAt: number
  runId: string
  evidence: string
  activityIds: string[] // JSON array in DB
  confidence: number
  durationEstimateMin: number | null
}

/** Pattern with derived sighting stats (computed via JOIN). */
export interface PatternWithStats extends Pattern {
  sightingCount: number
  lastSeenAt: number | null
  lastConfidence: number | null
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

interface CountRow {
  readonly count: number
}

interface LastRunRow {
  readonly latest: number | null
}

export class PatternRepository {
  constructor(private readonly db: Database.Database) {}

  addPattern(pattern: Pattern): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO patterns (id, name, description, apps, automation_idea, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pattern.id,
        pattern.name,
        pattern.description,
        JSON.stringify(pattern.apps),
        pattern.automationIdea,
        pattern.createdAt,
      )
  }

  getPatternById(id: string): PatternWithStats | null {
    const row = this.db
      .prepare(
        `SELECT p.*,
                COUNT(s.id) AS sighting_count,
                MAX(s.detected_at) AS last_seen_at,
                (SELECT confidence FROM pattern_sightings WHERE pattern_id = p.id ORDER BY detected_at DESC LIMIT 1) AS last_confidence
         FROM patterns p
         LEFT JOIN pattern_sightings s ON s.pattern_id = p.id
         WHERE p.id = ?
         GROUP BY p.id`,
      )
      .get(id) as Record<string, unknown> | undefined

    return row ? this.rowToPatternWithStats(row) : null
  }

  getAllPatterns(): PatternWithStats[] {
    const rows = this.db
      .prepare(
        `SELECT p.*,
                COUNT(s.id) AS sighting_count,
                MAX(s.detected_at) AS last_seen_at,
                (SELECT confidence FROM pattern_sightings WHERE pattern_id = p.id ORDER BY detected_at DESC LIMIT 1) AS last_confidence
         FROM patterns p
         LEFT JOIN pattern_sightings s ON s.pattern_id = p.id
         WHERE p.rejected_at IS NULL
         GROUP BY p.id
         ORDER BY sighting_count DESC`,
      )
      .all() as Record<string, unknown>[]

    return rows.map((row) => this.rowToPatternWithStats(row))
  }

  getRejectedPatterns(limit = 3): PatternWithStats[] {
    const rows = this.db
      .prepare(
        `SELECT p.*,
                COUNT(s.id) AS sighting_count,
                MAX(s.detected_at) AS last_seen_at,
                (SELECT confidence FROM pattern_sightings WHERE pattern_id = p.id ORDER BY detected_at DESC LIMIT 1) AS last_confidence
         FROM patterns p
         LEFT JOIN pattern_sightings s ON s.pattern_id = p.id
         WHERE p.rejected_at IS NOT NULL
         GROUP BY p.id
         ORDER BY sighting_count DESC
         LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[]

    return rows.map((row) => this.rowToPatternWithStats(row))
  }

  searchPatterns(query: string): PatternWithStats[] {
    const like = `%${query}%`
    const rows = this.db
      .prepare(
        `SELECT p.*,
                COUNT(s.id) AS sighting_count,
                MAX(s.detected_at) AS last_seen_at,
                (SELECT confidence FROM pattern_sightings WHERE pattern_id = p.id ORDER BY detected_at DESC LIMIT 1) AS last_confidence
         FROM patterns p
         LEFT JOIN pattern_sightings s ON s.pattern_id = p.id
         WHERE p.name LIKE ? OR p.description LIKE ? OR p.apps LIKE ?
         GROUP BY p.id
         ORDER BY sighting_count DESC`,
      )
      .all(like, like, like) as Record<string, unknown>[]

    return rows.map((row) => this.rowToPatternWithStats(row))
  }

  patternCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM patterns').get() as CountRow
    return row.count
  }

  // -- Status updates --

  approvePattern(id: string): void {
    this.db.prepare(`UPDATE patterns SET approved_at = ? WHERE id = ?`).run(Date.now(), id)
  }

  rejectPattern(id: string): void {
    this.db.prepare(`UPDATE patterns SET rejected_at = ? WHERE id = ?`).run(Date.now(), id)
  }

  updatePattern(
    id: string,
    fields: { name?: string; description?: string; apps?: string[]; automationIdea?: string },
  ): void {
    const sets: string[] = []
    const values: unknown[] = []
    if (fields.name) {
      sets.push('name = ?')
      values.push(fields.name)
    }
    if (fields.description) {
      sets.push('description = ?')
      values.push(fields.description)
    }
    if (fields.apps) {
      sets.push('apps = ?')
      values.push(JSON.stringify(fields.apps))
    }
    if (fields.automationIdea) {
      sets.push('automation_idea = ?')
      values.push(fields.automationIdea)
    }
    if (sets.length === 0) return
    values.push(id)
    this.db.prepare(`UPDATE patterns SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }

  markPromptCopied(id: string): void {
    this.db.prepare(`UPDATE patterns SET prompt_copied_at = ? WHERE id = ?`).run(Date.now(), id)
  }

  // -- Sightings --

  addSighting(sighting: PatternSighting): void {
    this.db
      .prepare(
        `INSERT INTO pattern_sightings (id, pattern_id, detected_at, run_id, evidence, activity_ids, confidence, duration_estimate_min)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sighting.id,
        sighting.patternId,
        sighting.detectedAt,
        sighting.runId,
        sighting.evidence,
        JSON.stringify(sighting.activityIds),
        sighting.confidence,
        sighting.durationEstimateMin,
      )
  }

  getSightingsForPattern(patternId: string, limit = 20): PatternSighting[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM pattern_sightings WHERE pattern_id = ? ORDER BY detected_at DESC LIMIT ?`,
      )
      .all(patternId, limit) as Record<string, unknown>[]

    return rows.map((row) => this.rowToSighting(row))
  }

  getSightingsByRunId(runId: string): PatternSighting[] {
    const rows = this.db
      .prepare(`SELECT * FROM pattern_sightings WHERE run_id = ? ORDER BY detected_at DESC`)
      .all(runId) as Record<string, unknown>[]

    return rows.map((row) => this.rowToSighting(row))
  }

  getLastRunTimestamp(): number | null {
    const row = this.db
      .prepare('SELECT MAX(ran_at) AS latest FROM pattern_detection_runs')
      .get() as LastRunRow
    return row.latest ?? null
  }

  recordRun(runId: string, findingsCount: number): void {
    this.db
      .prepare('INSERT INTO pattern_detection_runs (id, ran_at, findings_count) VALUES (?, ?, ?)')
      .run(runId, Date.now(), findingsCount)
  }

  // -- Cleanup --

  /**
   * Delete sightings older than `maxAgeDays`. If a pattern has no remaining
   * sightings after pruning, delete the pattern too. Returns counts.
   */
  pruneStale(maxAgeDays = 30): { sightings: number; patterns: number } {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000

    const sightings = this.db
      .prepare('DELETE FROM pattern_sightings WHERE detected_at < ?')
      .run(cutoff).changes

    const patterns = this.db
      .prepare(
        `DELETE FROM patterns WHERE id NOT IN (
           SELECT DISTINCT pattern_id FROM pattern_sightings
         )`,
      )
      .run().changes

    return { sightings, patterns }
  }

  // -- Private helpers --

  private rowToPatternWithStats(row: Record<string, unknown>): PatternWithStats {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      apps: JSON.parse((row.apps as string) || '[]') as string[],
      automationIdea: row.automation_idea as string,
      createdAt: row.created_at as number,
      rejectedAt: (row.rejected_at as number) ?? null,
      promptCopiedAt: (row.prompt_copied_at as number) ?? null,
      approvedAt: (row.approved_at as number) ?? null,
      sightingCount: (row.sighting_count as number) || 0,
      lastSeenAt: (row.last_seen_at as number) ?? null,
      lastConfidence: (row.last_confidence as number) ?? null,
    }
  }

  private rowToSighting(row: Record<string, unknown>): PatternSighting {
    return {
      id: row.id as string,
      patternId: row.pattern_id as string,
      detectedAt: row.detected_at as number,
      runId: row.run_id as string,
      evidence: row.evidence as string,
      activityIds: JSON.parse((row.activity_ids as string) || '[]') as string[],
      confidence: row.confidence as number,
      durationEstimateMin: (row.duration_estimate_min as number) ?? null,
    }
  }
}
