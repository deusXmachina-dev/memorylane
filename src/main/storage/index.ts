import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import * as fs from 'fs'
import * as path from 'path'
import { getDefaultDbPath } from '../paths'
import log from '../logger'
import { ActivityRepository } from './activity-repository'
import { PatternRepository } from './pattern-repository'
import { UserContextRepository } from './user-context-repository'

export { ActivityRepository } from './activity-repository'
export { PatternRepository } from './pattern-repository'
export { UserContextRepository } from './user-context-repository'
export type { Pattern, PatternSighting, PatternWithStats } from './pattern-repository'
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
  readonly userContext: UserContextRepository

  constructor(dbPath?: string) {
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
}
