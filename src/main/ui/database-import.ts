import { type BrowserWindow } from 'electron'
import { showMessageBox, showOpenDialog } from '@main/ui/dialogs'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import path from 'node:path'
import * as yauzl from 'yauzl'
import log from '@main/utils/logger'
import type { DatabaseImportResult } from '../../shared/types'

interface ImportDatabaseOptions {
  /** Active database path, resolved by the caller (the open StorageService). */
  dbPath: string
  parentWindow?: BrowserWindow | null
}

function pad2(v: number): string {
  return String(v).padStart(2, '0')
}

function buildTimestamp(now = new Date()): string {
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(
    now.getHours(),
  )}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
}

function pendingImportPath(dbPath: string): string {
  return `${dbPath}.pending-import`
}

/**
 * Extracts the database from a ZIP archive to `destPath` — the first `*.db`
 * entry, ignoring directories and macOS `__MACOSX`/AppleDouble (`._*`) cruft so
 * a re-zipped export still imports. Rejects if the archive has no `.db` entry.
 */
function extractDatabaseFromZip(zipPath: string, destPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err instanceof Error ? err : new Error('Failed to open ZIP archive'))
        return
      }

      let extracted = false
      zipfile.on('error', reject)
      zipfile.on('end', () => {
        if (!extracted) reject(new Error('No database (.db) file found in the ZIP archive.'))
      })

      zipfile.on('entry', (entry) => {
        const name = entry.fileName
        const isDir = name.endsWith('/')
        const isMacCruft = name.startsWith('__MACOSX/') || path.basename(name).startsWith('._')
        if (isDir || isMacCruft || !name.toLowerCase().endsWith('.db')) {
          zipfile.readEntry()
          return
        }

        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr || !readStream) {
            reject(streamErr instanceof Error ? streamErr : new Error('Failed to read ZIP entry'))
            return
          }
          const output = fs.createWriteStream(destPath)
          readStream.once('error', reject)
          output.once('error', reject)
          output.once('close', () => {
            extracted = true
            zipfile.close()
            resolve()
          })
          readStream.pipe(output)
        })
      })

      zipfile.readEntry()
    })
  })
}

/**
 * Confirms the file is a usable MemoryLane database by opening it read-only and
 * checking for the core tables. Migrations run on next startup, so an older
 * schema is fine — we only require the essentials to be present. Throws with a
 * user-facing message when the file is missing tables or is not a SQLite DB.
 */
function validateDatabaseFile(dbFilePath: string): void {
  const names = new Set<string>()
  let db: Database.Database | null = null
  try {
    db = new Database(dbFilePath, { readonly: true, fileMustExist: true })
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('activities', 'schema_migrations')",
      )
      .all() as Array<{ name: string }>
    for (const r of rows) names.add(r.name)
  } catch {
    throw new Error('Selected file could not be read as a SQLite database.')
  } finally {
    db?.close()
  }

  if (!names.has('activities') || !names.has('schema_migrations')) {
    throw new Error('Selected file is not a MemoryLane database (missing required tables).')
  }
}

/**
 * Lets the user pick an exported database (`.zip` or raw `.db`), confirms the
 * destructive replace, validates it, and stages it next to the active DB. The
 * actual swap happens on next startup via {@link applyPendingDatabaseImport};
 * the live database is never touched here while it is open.
 */
export async function importDatabase({
  dbPath,
  parentWindow = null,
}: ImportDatabaseOptions): Promise<DatabaseImportResult> {
  const pendingPath = pendingImportPath(dbPath)
  // Stage onto the same filesystem as the live DB so the final move is an atomic
  // rename, and write the staged file once. The `.partial` is promoted to the
  // pending path only after validation, so startup never sees an unvalidated file.
  const stagingPath = `${pendingPath}.partial`

  try {
    const openResult = await showOpenDialog(parentWindow, {
      title: 'Import Database',
      buttonLabel: 'Import',
      properties: ['openFile'],
      filters: [{ name: 'MemoryLane Database', extensions: ['zip', 'db'] }],
    })

    if (openResult.canceled || openResult.filePaths.length === 0) {
      return { success: false, cancelled: true }
    }
    const selectedPath = openResult.filePaths[0]

    const confirm = await showMessageBox(parentWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Import and Replace'],
      defaultId: 0,
      cancelId: 0,
      title: 'Replace Database',
      message: 'Replace the current database with the imported one?',
      detail:
        'All current activities and data will be replaced by the imported database. ' +
        'A backup of your current database is saved automatically, and the app will restart to finish importing.',
    })
    if (confirm.response !== 1) {
      return { success: false, cancelled: true }
    }

    if (selectedPath.toLowerCase().endsWith('.zip')) {
      await extractDatabaseFromZip(selectedPath, stagingPath)
    } else {
      await fsPromises.copyFile(selectedPath, stagingPath)
    }

    validateDatabaseFile(stagingPath)
    await fsPromises.rename(stagingPath, pendingPath)

    return { success: true }
  } catch (error) {
    log.error('[DatabaseImport] Error importing database:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  } finally {
    // Drop a leftover partial; the promoted pending file (post-rename) is kept.
    await fsPromises
      .rm(stagingPath, { force: true })
      .catch((cleanupError) =>
        log.warn('[DatabaseImport] Failed to clean staging file:', cleanupError),
      )
  }
}

/**
 * Applies a staged database import, if one exists. Called once during startup
 * BEFORE the database connection is opened. Backs up the current database, then
 * replaces it (and its WAL/SHM sidecars) with the staged file. On any failure
 * the existing database is left untouched so the app still boots.
 */
export function applyPendingDatabaseImport(dbPath: string): void {
  const pendingPath = pendingImportPath(dbPath)
  if (!fs.existsSync(pendingPath)) {
    return
  }

  log.info('[DatabaseImport] Pending database import detected, applying...')
  try {
    if (fs.existsSync(dbPath)) {
      const backupPath = path.join(path.dirname(dbPath), `memorylane-backup-${buildTimestamp()}.db`)
      fs.copyFileSync(dbPath, backupPath)
      log.info(`[DatabaseImport] Backed up current database to ${backupPath}`)
    }

    // Drop the live DB and its journal sidecars so no stale WAL is reattached.
    for (const suffix of ['', '-wal', '-shm']) {
      const target = `${dbPath}${suffix}`
      if (fs.existsSync(target)) {
        fs.rmSync(target, { force: true })
      }
    }

    fs.renameSync(pendingPath, dbPath)
    log.info('[DatabaseImport] Database import applied successfully')
  } catch (error) {
    log.error('[DatabaseImport] Failed to apply pending database import:', error)
    // Leave the existing DB intact and drop the partial staging file so the app boots.
    try {
      if (fs.existsSync(pendingPath)) {
        fs.rmSync(pendingPath, { force: true })
      }
    } catch (cleanupError) {
      log.warn('[DatabaseImport] Failed to remove pending import file:', cleanupError)
    }
  }
}
