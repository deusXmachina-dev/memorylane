import type Database from 'better-sqlite3'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserContext {
  shortSummary: string
  detailedSummary: string
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

interface UserContextRow {
  readonly short_summary: string
  readonly detailed_summary: string
  readonly updated_at: number
}

export class UserContextRepository {
  constructor(private readonly db: Database.Database) {}

  get(): UserContext | null {
    const row = this.db
      .prepare('SELECT short_summary, detailed_summary, updated_at FROM user_context WHERE id = 1')
      .get() as UserContextRow | undefined

    if (!row) return null

    return {
      shortSummary: row.short_summary,
      detailedSummary: row.detailed_summary,
      updatedAt: row.updated_at,
    }
  }

  upsert(shortSummary: string, detailedSummary: string): void {
    this.db
      .prepare(
        `INSERT INTO user_context (id, short_summary, detailed_summary, updated_at)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           short_summary = excluded.short_summary,
           detailed_summary = excluded.detailed_summary,
           updated_at = excluded.updated_at`,
      )
      .run(shortSummary, detailedSummary, Date.now())
  }
}
