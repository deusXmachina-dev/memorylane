import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import * as fs from 'fs'
import * as path from 'path'
import { getDefaultDbPath } from '@main/utils/paths'
import log from '@main/utils/logger'
import { ActivityRepository } from './activity-repository'
import { PatternRepository } from './pattern-repository'
import { SightingRepository } from './sighting-repository'
import { MiningRunRepository } from './mining-run-repository'
import { UploadRunRepository } from './upload-run-repository'
import { UserContextRepository } from './user-context-repository'

export { ActivityRepository } from './activity-repository'
export { PatternRepository } from './pattern-repository'
export { SightingRepository } from './sighting-repository'
export { MiningRunRepository } from './mining-run-repository'
export { UploadRunRepository } from './upload-run-repository'
export { UserContextRepository } from './user-context-repository'
export type { Pattern, PatternSighting, PatternWithStats } from './pattern-repository'
export type { Sighting } from './sighting-repository'
export type { UserContext } from './user-context-repository'
export type { StoredActivity, ActivitySummary, ActivityDetail } from './types'

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

export class StorageService {
  private dbPath: string
  private db: Database.Database | null = null
  readonly activities: ActivityRepository
  readonly patterns: PatternRepository
  readonly sightings: SightingRepository
  readonly miningRuns: MiningRunRepository
  readonly uploadRuns: UploadRunRepository
  readonly userContext: UserContextRepository

  constructor(dbPath?: string) {
    // The fallback is edition-agnostic (customer default). The Electron main
    // process always passes an explicit `dbPath` via runtime.ts, which derives
    // from `app.getPath('userData')` and is therefore edition-correct. Only
    // scripts/tests hit this branch, and they don't need enterprise routing.
    this.dbPath = dbPath ?? getDefaultDbPath()

    const dir = path.dirname(this.dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    log.info(`Initializing SQLite database at: ${this.dbPath}`)
    const db = new Database(this.dbPath)

    try {
      db.pragma('journal_mode = WAL')

      loadSqliteVecExtension(db)

      this.db = db
      this.activities = new ActivityRepository(db)
      this.patterns = new PatternRepository(db)
      this.sightings = new SightingRepository(db)
      this.miningRuns = new MiningRunRepository(db)
      this.uploadRuns = new UploadRunRepository(db)
      this.userContext = new UserContextRepository(db)
      log.info('SQLite database initialized successfully')
    } catch (error) {
      db.close()
      throw error
    }
  }

  /**
   * Helper to get the default database path based on environment.
   */
  public static getDefaultDbPath(): string {
    return getDefaultDbPath()
  }

  /**
   * Returns the raw database handle.
   */
  public getDatabase(): Database.Database {
    if (!this.db) throw new Error('Database not initialized')
    return this.db
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
  public close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  /**
   * Permanently deletes all user data while preserving the schema and
   * migration history. The database file, repository instances, and any
   * cached references remain valid after this call.
   *
   * Table discovery is dynamic so that any future migration which adds
   * a user-data table is purged automatically.
   */
  public purge(): void {
    if (!this.db) {
      throw new Error('Database is closed')
    }
    const db = this.db

    type TableRow = { name: string; sql: string | null }
    const rows = db
      .prepare(
        `SELECT name, sql FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
           AND name != 'schema_migrations'
           AND sql IS NOT NULL`,
      )
      .all() as TableRow[]

    // First pass: discover virtual tables so we can exclude their
    // shadow/companion tables (FTS5 -> *_data/_idx/_content/_docsize/_config,
    // vec0 -> *_chunks/_rowids/_vector_chunks*, etc.).
    const ftsTables: string[] = []
    const otherVirtualTables: string[] = []
    for (const row of rows) {
      const sql = row.sql ?? ''
      if (!/CREATE\s+VIRTUAL\s+TABLE/i.test(sql)) continue
      if (/USING\s+fts5/i.test(sql)) ftsTables.push(row.name)
      else otherVirtualTables.push(row.name)
    }
    const virtualPrefixes = [...ftsTables, ...otherVirtualTables].map((n) => `${n}_`)

    const regularTables: string[] = []
    for (const row of rows) {
      const sql = row.sql ?? ''
      if (/CREATE\s+VIRTUAL\s+TABLE/i.test(sql)) continue
      if (virtualPrefixes.some((p) => row.name.startsWith(p))) continue
      regularTables.push(row.name)
    }

    const purgeAll = db.transaction(() => {
      // Defer FK checks so deletion order across parent/child tables
      // doesn't matter — at commit time every table is empty.
      db.exec('PRAGMA defer_foreign_keys = ON')
      for (const t of otherVirtualTables) db.exec(`DELETE FROM "${t}"`)
      for (const t of regularTables) db.exec(`DELETE FROM "${t}"`)
      // FTS5 virtual tables don't accept DELETE; rebuild from the
      // (now-empty) content table instead.
      for (const t of ftsTables) db.exec(`INSERT INTO "${t}"("${t}") VALUES('rebuild')`)
    })
    purgeAll()
    db.exec('VACUUM')
    log.info(
      `Storage purged: ${regularTables.length} table(s), ` +
        `${ftsTables.length} FTS index(es), ${otherVirtualTables.length} vec table(s)`,
    )
  }
}
