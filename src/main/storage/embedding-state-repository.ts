import type Database from 'better-sqlite3'

export interface EmbeddingState {
  activityModel: string
  activityCursor: number
  signatureModel: string
}

interface EmbeddingStateRow {
  readonly activity_model: string
  readonly activity_cursor: number
  readonly signature_model: string
}

/** Which embedding model produced the stored vectors. No row (fresh purge) = nothing stale. */
export class EmbeddingStateRepository {
  constructor(private readonly db: Database.Database) {}

  get(): EmbeddingState | null {
    const row = this.db
      .prepare(
        'SELECT activity_model, activity_cursor, signature_model FROM embedding_state WHERE id = 1',
      )
      .get() as EmbeddingStateRow | undefined
    if (!row) return null
    return {
      activityModel: row.activity_model,
      activityCursor: row.activity_cursor,
      signatureModel: row.signature_model,
    }
  }

  setActivityCursor(rowid: number): void {
    this.db.prepare('UPDATE embedding_state SET activity_cursor = ? WHERE id = 1').run(rowid)
  }

  setActivityModel(model: string): void {
    this.db
      .prepare('UPDATE embedding_state SET activity_model = ?, activity_cursor = 0 WHERE id = 1')
      .run(model)
  }

  setSignatureModel(model: string): void {
    this.db.prepare('UPDATE embedding_state SET signature_model = ? WHERE id = 1').run(model)
  }
}
