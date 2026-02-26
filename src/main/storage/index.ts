import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import * as fs from 'fs'
import * as path from 'path'
import { getDefaultDbPath } from '../paths'
import { SearchFilters } from '../../shared/types'
import log from '../logger'
import { ensureMigrationsTable, runMigrations } from './migrator'

/**
 * Loads the sqlite-vec extension into the given database.
 * Falls back to manual path resolution for packaged Electron apps where
 * the platform-specific package may be nested or inside app.asar.unpacked.
 */
function loadSqliteVecExtension(db: Database.Database): void {
  try {
    sqliteVec.load(db)
    return
  } catch (defaultError) {
    log.warn(`Default sqlite-vec loader failed, attempting manual resolution: ${defaultError}`)
  }

  const ext = process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so'
  const platformName = process.platform === 'win32' ? 'windows' : process.platform
  const packageName = `sqlite-vec-${platformName}-${process.arch}`
  const filename = `vec0.${ext}`

  const searchPaths: string[] = []

  const resourcesPath = 'resourcesPath' in process ? (process.resourcesPath as string) : null
  if (resourcesPath) {
    const unpacked = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules')
    searchPaths.push(
      path.join(unpacked, 'sqlite-vec', 'node_modules', packageName, filename),
      path.join(unpacked, packageName, filename),
    )
  }

  for (const candidate of searchPaths) {
    if (fs.existsSync(candidate)) {
      log.info(`Loading sqlite-vec extension from: ${candidate}`)
      db.loadExtension(candidate)
      return
    }
  }

  throw new Error(
    `sqlite-vec extension not found for ${packageName}. Searched: ${searchPaths.join(', ')}`,
  )
}

export interface StoredActivity extends Record<string, unknown> {
  id: string
  startTimestamp: number
  endTimestamp: number
  appName: string
  windowTitle: string
  tld: string | null
  summary: string
  ocrText: string
  vector: number[]
}

/** Lightweight activity without heavy ocr_text and vector fields. */
export interface ActivitySummary {
  id: string
  startTimestamp: number
  endTimestamp: number
  appName: string
  summary: string
}

/** sqlite-vec hard limit for the k parameter in knn queries. */
const SQLITE_VEC_KNN_MAX = 4096

/**
 * Sanitizes a user query string for FTS5 MATCH.
 * Quotes each token to prevent FTS5 syntax errors from special characters.
 */
function sanitizeFtsQuery(query: string): string {
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return '""'
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' ')
}

interface CountRow {
  readonly count: number
}

interface DateRangeRow {
  readonly oldest: number | null
  readonly newest: number | null
}

export class StorageService {
  private dbPath: string
  private db: Database.Database | null = null

  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  /**
   * Helper to get the default database path based on environment.
   */
  public static getDefaultDbPath(): string {
    return getDefaultDbPath()
  }

  /**
   * Initializes the SQLite database and runs pending migrations.
   * Only sets this.db after all setup steps succeed so that a partial
   * failure does not leave the instance in an inconsistent state.
   */
  public async init(): Promise<void> {
    if (this.db) return

    const dir = path.dirname(this.dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    log.info(`Initializing SQLite database at: ${this.dbPath}`)
    const db = new Database(this.dbPath)

    try {
      db.pragma('journal_mode = WAL')

      loadSqliteVecExtension(db)

      ensureMigrationsTable(db)
      runMigrations(db)

      this.db = db
      log.info('SQLite database initialized successfully')
    } catch (error) {
      db.close()
      throw error
    }
  }

  /**
   * Returns the total number of activities in the database.
   */
  public async countRows(): Promise<number> {
    if (!this.db) {
      await this.init()
    }
    if (!this.db) return 0

    return this.getActivityRowCount()
  }

  /**
   * Returns the date range (oldest and newest timestamps) in the database.
   */
  public async getDateRange(): Promise<{ oldest: number | null; newest: number | null }> {
    if (!this.db) {
      await this.init()
    }
    if (!this.db) return { oldest: null, newest: null }

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

  /**
   * Returns the database path.
   */
  public getDbPath(): string {
    return this.dbPath
  }

  /**
   * Returns the size of the database file in bytes.
   */
  public getDbSize(): number {
    if (!fs.existsSync(this.dbPath)) return 0
    return fs.statSync(this.dbPath).size
  }

  /**
   * Writes a consistent SQLite backup snapshot to the destination path.
   * Safe to use while the database is open and operating in WAL mode.
   */
  public async backupToFile(destinationPath: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database is closed')
    }
    await this.db.backup(destinationPath)
  }

  /**
   * Closes the database connection.
   */
  public async close(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  // ---------------------------------------------------------------------------
  // Activity methods
  // ---------------------------------------------------------------------------

  /**
   * Adds an activity to the storage.
   */
  public async addActivity(activity: StoredActivity): Promise<void> {
    if (!this.db) {
      await this.init()
    }
    if (!this.db) throw new Error('Failed to initialize SQLite database')

    const vectorBlob = this.vectorToBlob(activity.vector)

    const insert = this.db.transaction(() => {
      this.db!.prepare(
        `INSERT INTO activities (id, start_timestamp, end_timestamp, app_name, window_title, tld, summary, ocr_text, vector)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        activity.id,
        activity.startTimestamp,
        activity.endTimestamp,
        activity.appName,
        activity.windowTitle,
        activity.tld,
        activity.summary,
        activity.ocrText,
        vectorBlob,
      )

      this.db!.prepare(
        `INSERT INTO activities_vec (id, embedding)
         VALUES (?, ?)`,
      ).run(activity.id, vectorBlob)
    })

    insert()
  }

  /**
   * Full-text search across activity summary and OCR text.
   * Returns lightweight summaries ranked by FTS5 BM25 relevance.
   */
  public async searchActivitiesFTS(
    query: string,
    limit = 5,
    filters?: SearchFilters,
  ): Promise<ActivitySummary[]> {
    if (!this.db) {
      await this.init()
    }
    if (!this.db) return []

    const count = this.getActivityRowCount()
    if (count === 0) return []

    const safeQuery = sanitizeFtsQuery(query)
    const { conditions, params } = this.buildActivityFilterConditions(filters)
    const filterClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''

    const rows = this.db
      .prepare(
        `SELECT a.id, a.start_timestamp, a.end_timestamp, a.app_name, a.summary
         FROM activities_fts fts
         JOIN activities a ON a.rowid = fts.rowid
         WHERE activities_fts MATCH ?
         ${filterClause}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(safeQuery, ...params, limit) as Record<string, unknown>[]

    return rows.map((row) => this.rowToActivitySummary(row))
  }

  /**
   * Vector similarity search over activities.
   * Returns lightweight summaries ordered by cosine distance (most relevant first).
   */
  public async searchActivitiesVectors(
    queryVector: number[],
    limit = 5,
    filters?: SearchFilters,
  ): Promise<ActivitySummary[]> {
    if (!this.db) {
      await this.init()
    }
    if (!this.db) return []

    const count = this.getActivityRowCount()
    if (count === 0) return []

    const vectorBlob = this.vectorToBlob(queryVector)
    const hasFilters =
      filters &&
      (filters.startTime !== undefined ||
        filters.endTime !== undefined ||
        filters.appName !== undefined)

    if (!hasFilters) {
      const effectiveLimit = Math.min(limit, SQLITE_VEC_KNN_MAX)
      const rows = this.db
        .prepare(
          `SELECT a.id, a.start_timestamp, a.end_timestamp, a.app_name, a.summary
           FROM (
             SELECT id, distance
             FROM activities_vec
             WHERE embedding MATCH ?
             AND k = ?
           ) vec
           JOIN activities a ON a.id = vec.id`,
        )
        .all(vectorBlob, effectiveLimit) as Record<string, unknown>[]

      return rows.map((row) => this.rowToActivitySummary(row))
    }

    const overFetchLimit = Math.min(Math.max(limit * 10, count), SQLITE_VEC_KNN_MAX)
    const { conditions, params } = this.buildActivityFilterConditions(filters)
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = this.db
      .prepare(
        `SELECT a.id, a.start_timestamp, a.end_timestamp, a.app_name, a.summary
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
      .all(vectorBlob, overFetchLimit, ...params, limit) as Record<string, unknown>[]

    if (rows.length < limit) {
      log.warn(
        `Vector search with filters returned ${rows.length}/${limit} requested results ` +
          `(overfetched ${overFetchLimit} of ${count} total). ` +
          'Some relevant results may have been missed due to KNN pre-filtering.',
      )
    }

    return rows.map((row) => this.rowToActivitySummary(row))
  }

  /**
   * Returns lightweight activity summaries within a time range, sorted by start_timestamp ascending.
   */
  public async getActivitiesByTimeRange(
    startTime: number | null = null,
    endTime: number | null = null,
    options?: { appName?: string | undefined },
  ): Promise<ActivitySummary[]> {
    if (!this.db) {
      await this.init()
    }
    if (!this.db) return []

    const conditions: string[] = []
    const params: unknown[] = []

    if (startTime !== null) {
      conditions.push('start_timestamp >= ?')
      params.push(startTime)
    }
    if (endTime !== null) {
      conditions.push('start_timestamp <= ?')
      params.push(endTime)
    }
    if (options?.appName !== undefined) {
      conditions.push('app_name = ? COLLATE NOCASE')
      params.push(options.appName)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = this.db
      .prepare(
        `SELECT id, start_timestamp, end_timestamp, app_name, summary
         FROM activities
         ${whereClause}
         ORDER BY start_timestamp ASC`,
      )
      .all(...params) as Record<string, unknown>[]

    return rows.map((row) => this.rowToActivitySummary(row))
  }

  /**
   * Retrieves multiple activities by their IDs.
   */
  public async getActivitiesByIds(ids: readonly string[]): Promise<StoredActivity[]> {
    if (!this.db) {
      await this.init()
    }
    if (!this.db || ids.length === 0) return []

    const placeholders = ids.map(() => '?').join(', ')
    const rows = this.db
      .prepare(
        `SELECT id, start_timestamp, end_timestamp, app_name, window_title, tld, summary, ocr_text, vector
         FROM activities
         WHERE id IN (${placeholders})`,
      )
      .all(...ids) as Record<string, unknown>[]

    return rows.map((row) => this.rowToStoredActivity(row))
  }

  /**
   * Returns the total number of activities in the database.
   */
  public async countActivityRows(): Promise<number> {
    if (!this.db) {
      await this.init()
    }
    if (!this.db) return 0

    return this.getActivityRowCount()
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private vectorToBlob(vector: number[]): Buffer {
    const float32 = new Float32Array(vector)
    return Buffer.from(float32.buffer, float32.byteOffset, float32.byteLength)
  }

  private blobToVector(blob: Buffer): number[] {
    const float32 = new Float32Array(
      blob.buffer,
      blob.byteOffset,
      blob.byteLength / Float32Array.BYTES_PER_ELEMENT,
    )
    return Array.from(float32)
  }

  private getActivityRowCount(): number {
    if (!this.db) return 0
    const result = this.db.prepare('SELECT COUNT(*) as count FROM activities').get() as CountRow
    return result.count
  }

  private rowToActivitySummary(row: Record<string, unknown>): ActivitySummary {
    return {
      id: row.id as string,
      startTimestamp: row.start_timestamp as number,
      endTimestamp: row.end_timestamp as number,
      appName: row.app_name as string,
      summary: row.summary as string,
    }
  }

  private rowToStoredActivity(row: Record<string, unknown>): StoredActivity {
    return {
      id: row.id as string,
      startTimestamp: row.start_timestamp as number,
      endTimestamp: row.end_timestamp as number,
      appName: row.app_name as string,
      windowTitle: row.window_title as string,
      tld: (row.tld as string) ?? null,
      summary: row.summary as string,
      ocrText: row.ocr_text as string,
      vector: row.vector ? this.blobToVector(row.vector as Buffer) : [],
    }
  }

  private buildActivityFilterConditions(filters?: SearchFilters): {
    conditions: string[]
    params: unknown[]
  } {
    const conditions: string[] = []
    const params: unknown[] = []

    if (!filters) return { conditions, params }

    if (filters.startTime !== undefined) {
      conditions.push('a.start_timestamp >= ?')
      params.push(filters.startTime)
    }
    if (filters.endTime !== undefined) {
      conditions.push('a.start_timestamp <= ?')
      params.push(filters.endTime)
    }
    if (filters.appName !== undefined) {
      conditions.push('a.app_name = ? COLLATE NOCASE')
      params.push(filters.appName)
    }

    return { conditions, params }
  }
}
