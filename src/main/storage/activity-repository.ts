import type Database from 'better-sqlite3'
import type { SearchFilters } from '../../shared/types'
import type { StoredActivity, ActivitySummary, ActivityDetail } from './types'
import { vectorToBlob, blobToVector, sanitizeFtsQuery, SQLITE_VEC_KNN_MAX } from './utils'
import log from '../logger'

interface CountRow {
  readonly count: number
}

interface DateRangeRow {
  readonly oldest: number | null
  readonly newest: number | null
}

export class ActivityRepository {
  constructor(private readonly db: Database.Database) {}

  add(activity: StoredActivity): void {
    const blob = vectorToBlob(activity.vector)

    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO activities (id, start_timestamp, end_timestamp, app_name, window_title, tld, summary, ocr_text, vector)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          activity.id,
          activity.startTimestamp,
          activity.endTimestamp,
          activity.appName,
          activity.windowTitle,
          activity.tld,
          activity.summary,
          activity.ocrText,
          blob,
        )

      this.db
        .prepare(
          `INSERT INTO activities_vec (id, embedding)
         VALUES (?, ?)`,
        )
        .run(activity.id, blob)
    })

    insert()
  }

  searchFTS(query: string, limit = 5, filters?: SearchFilters): ActivitySummary[] {
    if (this.getRowCount() === 0) return []

    const safeQuery = sanitizeFtsQuery(query)
    const { conditions, params } = this.buildFilterConditions(filters)
    const filterClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''

    const rows = this.db
      .prepare(
        `SELECT a.id, a.start_timestamp, a.end_timestamp, a.app_name, a.window_title, a.summary
       FROM activities_fts fts
       JOIN activities a ON a.rowid = fts.rowid
       WHERE activities_fts MATCH ?
       ${filterClause}
       ORDER BY rank
       LIMIT ?`,
      )
      .all(safeQuery, ...params, limit) as Record<string, unknown>[]

    return rows.map((row) => this.rowToSummary(row))
  }

  searchVectors(queryVector: number[], limit = 5, filters?: SearchFilters): ActivitySummary[] {
    if (this.getRowCount() === 0) return []

    const blob = vectorToBlob(queryVector)
    const hasFilters =
      filters &&
      (filters.startTime !== undefined ||
        filters.endTime !== undefined ||
        filters.appName !== undefined)

    if (!hasFilters) {
      const effectiveLimit = Math.min(limit, SQLITE_VEC_KNN_MAX)
      const rows = this.db
        .prepare(
          `SELECT a.id, a.start_timestamp, a.end_timestamp, a.app_name, a.window_title, a.summary
         FROM (
           SELECT id, distance
           FROM activities_vec
           WHERE embedding MATCH ?
           AND k = ?
         ) vec
         JOIN activities a ON a.id = vec.id`,
        )
        .all(blob, effectiveLimit) as Record<string, unknown>[]

      return rows.map((row) => this.rowToSummary(row))
    }

    const count = this.getRowCount()
    const overFetchLimit = Math.min(Math.max(limit * 10, count), SQLITE_VEC_KNN_MAX)
    const { conditions, params } = this.buildFilterConditions(filters)
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = this.db
      .prepare(
        `SELECT a.id, a.start_timestamp, a.end_timestamp, a.app_name, a.window_title, a.summary
       FROM (
         SELECT id, distance
         FROM activities_vec
         WHERE embedding MATCH ?
         AND k = ?
       ) vec
       JOIN activities a ON a.id = vec.id
       ${whereClause}
       ORDER BY vec.distance
       LIMIT ?`,
      )
      .all(blob, overFetchLimit, ...params, limit) as Record<string, unknown>[]

    if (rows.length < limit) {
      log.warn(
        `Vector search with filters returned ${rows.length}/${limit} requested results ` +
          `(overfetched ${overFetchLimit} of ${count} total). ` +
          'Some relevant results may have been missed due to KNN pre-filtering.',
      )
    }

    return rows.map((row) => this.rowToSummary(row))
  }

  getByTimeRange(
    startTime: number | null = null,
    endTime: number | null = null,
    options?: { appName?: string | undefined },
  ): ActivitySummary[] {
    const { conditions, params } = this.buildFilterConditions(
      {
        startTime: startTime ?? undefined,
        endTime: endTime ?? undefined,
        appName: options?.appName,
      },
      '',
    )

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = this.db
      .prepare(
        `SELECT id, start_timestamp, end_timestamp, app_name, window_title, summary
       FROM activities
       ${whereClause}
       ORDER BY start_timestamp ASC`,
      )
      .all(...params) as Record<string, unknown>[]

    return rows.map((row) => this.rowToSummary(row))
  }

  getByIds(ids: readonly string[]): StoredActivity[] {
    if (ids.length === 0) return []

    const placeholders = ids.map(() => '?').join(', ')
    const rows = this.db
      .prepare(
        `SELECT id, start_timestamp, end_timestamp, app_name, window_title, tld, summary, ocr_text, vector
       FROM activities
       WHERE id IN (${placeholders})`,
      )
      .all(...ids) as Record<string, unknown>[]

    return rows.map((row) => this.rowToStored(row))
  }

  /**
   * Get all activities for a calendar day with window context (windowTitle, tld).
   * Excludes heavy ocrText and vector fields.
   */
  getForDay(dayStart: number, dayEnd: number): ActivityDetail[] {
    const rows = this.db
      .prepare(
        `SELECT id, start_timestamp, end_timestamp, app_name, window_title, tld, summary
       FROM activities
       WHERE end_timestamp >= ? AND start_timestamp <= ?
       ORDER BY start_timestamp ASC`,
      )
      .all(dayStart, dayEnd) as Record<string, unknown>[]

    return rows.map((row) => this.rowToDetail(row))
  }

  count(): number {
    return this.getRowCount()
  }

  getDateRange(): { oldest: number | null; newest: number | null } {
    const result = this.db
      .prepare(
        'SELECT MIN(start_timestamp) as oldest, MAX(end_timestamp) as newest FROM activities',
      )
      .get() as DateRangeRow

    return {
      oldest: result.oldest ?? null,
      newest: result.newest ?? null,
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getRowCount(): number {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM activities').get() as CountRow
    return result.count
  }

  private rowToSummary(row: Record<string, unknown>): ActivitySummary {
    return {
      id: row.id as string,
      startTimestamp: row.start_timestamp as number,
      endTimestamp: row.end_timestamp as number,
      appName: row.app_name as string,
      windowTitle: row.window_title as string,
      summary: row.summary as string,
    }
  }

  private rowToDetail(row: Record<string, unknown>): ActivityDetail {
    return {
      id: row.id as string,
      startTimestamp: row.start_timestamp as number,
      endTimestamp: row.end_timestamp as number,
      appName: row.app_name as string,
      windowTitle: row.window_title as string,
      tld: (row.tld as string) ?? null,
      summary: row.summary as string,
    }
  }

  private rowToStored(row: Record<string, unknown>): StoredActivity {
    return {
      id: row.id as string,
      startTimestamp: row.start_timestamp as number,
      endTimestamp: row.end_timestamp as number,
      appName: row.app_name as string,
      windowTitle: row.window_title as string,
      tld: (row.tld as string) ?? null,
      summary: row.summary as string,
      ocrText: row.ocr_text as string,
      vector: row.vector ? blobToVector(row.vector as Buffer) : [],
    }
  }

  /**
   * Build SQL filter conditions from SearchFilters.
   * @param alias - Table alias prefix for column names. Defaults to 'a.' for joined queries.
   *                Pass '' for unaliased queries (e.g. direct table access).
   */
  private buildFilterConditions(
    filters?: SearchFilters,
    alias?: string,
  ): { conditions: string[]; params: unknown[] } {
    const conditions: string[] = []
    const params: unknown[] = []

    if (!filters) return { conditions, params }

    const prefix = alias === undefined ? 'a.' : alias === '' ? '' : `${alias}.`

    if (filters.startTime !== undefined) {
      conditions.push(`${prefix}end_timestamp >= ?`)
      params.push(filters.startTime)
    }
    if (filters.endTime !== undefined) {
      conditions.push(`${prefix}start_timestamp <= ?`)
      params.push(filters.endTime)
    }
    if (filters.appName !== undefined) {
      conditions.push(`${prefix}app_name = ? COLLATE NOCASE`)
      params.push(filters.appName)
    }

    return { conditions, params }
  }
}
