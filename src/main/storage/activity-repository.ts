import type Database from 'better-sqlite3'
import type { SearchFilters } from '../../shared/types'
import type { StoredActivity, ActivitySummary, ActivityDetail } from './types'
import { vectorToBlob, blobToVector, sanitizeFtsQuery, SQLITE_VEC_KNN_MAX } from './utils'
import { NON_WEBSITE_HOSTS, activityAppIdentity } from '../../shared/app-utils'
import log from '@main/utils/logger'

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
          `INSERT INTO activities (id, start_timestamp, end_timestamp, app_name, window_title, tld, summary, summary_model, ocr_text)
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
          activity.summaryModel,
          activity.ocrText,
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
        `SELECT a.id, a.start_timestamp, a.end_timestamp, a.app_name, a.window_title, a.tld, a.summary
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
          `SELECT a.id, a.start_timestamp, a.end_timestamp, a.app_name, a.window_title, a.tld, a.summary
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
        `SELECT a.id, a.start_timestamp, a.end_timestamp, a.app_name, a.window_title, a.tld, a.summary
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
        `SELECT id, start_timestamp, end_timestamp, app_name, window_title, tld, summary
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
        `SELECT id, start_timestamp, end_timestamp, app_name, window_title, tld, summary, summary_model, ocr_text
       FROM activities
       WHERE id IN (${placeholders})`,
      )
      .all(...ids) as Record<string, unknown>[]

    return rows.map((row) => this.rowToStored(row))
  }

  /**
   * Read raw embeddings back out of activities_vec. Missing ids (e.g. pruned
   * activities) are simply absent from the result.
   */
  getVectorsByIds(ids: readonly string[]): Map<string, number[]> {
    const result = new Map<string, number[]>()
    if (ids.length === 0) return result

    const placeholders = ids.map(() => '?').join(', ')
    const rows = this.db
      .prepare(`SELECT id, embedding FROM activities_vec WHERE id IN (${placeholders})`)
      .all(...ids) as { id: string; embedding: Buffer }[]

    for (const row of rows) {
      result.set(row.id, blobToVector(row.embedding))
    }
    return result
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

  /**
   * Distinct local calendar days with any captured activity in
   * [windowStart, windowEnd]. Local-day bucketing matches getDayBoundaries()
   * (local midnight); an activity counts for the day it started. Used as the
   * frequency denominator so laptop-off and pre-install days don't dilute.
   */
  countDistinctActiveDays(windowStart: number, windowEnd: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(DISTINCT date(start_timestamp / 1000, 'unixepoch', 'localtime')) AS days
       FROM activities
       WHERE start_timestamp >= ? AND start_timestamp <= ?`,
      )
      .get(windowStart, windowEnd) as { days: number }
    return row.days
  }

  count(): number {
    return this.getRowCount()
  }

  /**
   * Recent activities ordered newest-first. Excludes ocrText and vector.
   */
  listRecent(limit: number, offset = 0): ActivityDetail[] {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)))
    const safeOffset = Math.max(0, Math.trunc(offset))
    const rows = this.db
      .prepare(
        `SELECT id, start_timestamp, end_timestamp, app_name, window_title, tld, summary
       FROM activities
       ORDER BY start_timestamp DESC
       LIMIT ? OFFSET ?`,
      )
      .all(safeLimit, safeOffset) as Record<string, unknown>[]

    return rows.map((row) => this.rowToDetail(row))
  }

  getDistinctTlds(limit = 200): { tld: string; count: number; lastSeenAt: number }[] {
    const excludedHosts = [...NON_WEBSITE_HOSTS]
    const notInClause = excludedHosts.length
      ? ` AND tld NOT IN (${excludedHosts.map(() => '?').join(', ')})`
      : ''
    const rows = this.db
      .prepare(
        `SELECT tld, COUNT(*) AS count, MAX(end_timestamp) AS last_seen_at
       FROM activities
       WHERE tld IS NOT NULL AND tld != ''${notInClause}
       GROUP BY tld
       ORDER BY count DESC, last_seen_at DESC
       LIMIT ?`,
      )
      .all(...excludedHosts, limit) as Record<string, unknown>[]

    return rows.map((row) => ({
      tld: row.tld as string,
      count: row.count as number,
      lastSeenAt: row.last_seen_at as number,
    }))
  }

  /**
   * Top apps by captured-activity count, used by the trust digest on the
   * Activities page.
   */
  getTopApps(limit = 10): { appName: string; count: number }[] {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)))
    const rows = this.db
      .prepare(
        `SELECT app_name, tld, COUNT(*) AS count
       FROM activities
       WHERE app_name IS NOT NULL AND app_name != ''
       GROUP BY app_name, tld`,
      )
      .all() as { app_name: string; tld: string | null; count: number }[]

    const counts = new Map<string, number>()
    for (const row of rows) {
      const app = activityAppIdentity({ appName: row.app_name, tld: row.tld })
      counts.set(app, (counts.get(app) ?? 0) + row.count)
    }
    return [...counts.entries()]
      .map(([appName, count]) => ({ appName, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, safeLimit)
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
      appName: activityAppIdentity({
        appName: row.app_name as string,
        tld: (row.tld as string) ?? null,
      }),
      windowTitle: row.window_title as string,
      summary: row.summary as string,
    }
  }

  private rowToDetail(row: Record<string, unknown>): ActivityDetail {
    return {
      id: row.id as string,
      startTimestamp: row.start_timestamp as number,
      endTimestamp: row.end_timestamp as number,
      appName: activityAppIdentity({
        appName: row.app_name as string,
        tld: (row.tld as string) ?? null,
      }),
      windowTitle: row.window_title as string,
      summary: row.summary as string,
    }
  }

  private rowToStored(row: Record<string, unknown>): StoredActivity {
    return {
      id: row.id as string,
      startTimestamp: row.start_timestamp as number,
      endTimestamp: row.end_timestamp as number,
      appName: activityAppIdentity({
        appName: row.app_name as string,
        tld: (row.tld as string) ?? null,
      }),
      windowTitle: row.window_title as string,
      tld: (row.tld as string) ?? null,
      summary: row.summary as string,
      summaryModel: (row.summary_model as string) ?? '',
      ocrText: row.ocr_text as string,
      // Embeddings now live solely in activities_vec; getByIds no longer reads
      // them back (no production caller needs the per-activity vector here).
      vector: [],
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
      const escaped = filters.appName.replace(/[\\%_]/g, (c) => `\\${c}`)
      conditions.push(`(${prefix}app_name LIKE ? ESCAPE '\\' OR ${prefix}tld LIKE ? ESCAPE '\\')`)
      params.push(`%${escaped}%`, `%${escaped}%`)
    }

    return { conditions, params }
  }
}
