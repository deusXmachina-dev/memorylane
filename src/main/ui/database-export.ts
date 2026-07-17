import { app, type BrowserWindow } from 'electron'
import { showSaveDialog } from '@main/ui/dialogs'
import fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import log from '@main/utils/logger'
import { buildTimestampedZipName, createZipWithFiles, ensureZipExtension } from './zip'
import type { DatabaseExportResult } from '../../shared/types'

export interface DatabaseExportStorage {
  getDbPath(): string
  backupToFile(destinationPath: string): Promise<void>
}

interface ExportDatabaseZipOptions {
  storage: DatabaseExportStorage
  parentWindow?: BrowserWindow | null
}

export async function exportDatabaseZip({
  storage,
  parentWindow = null,
}: ExportDatabaseZipOptions): Promise<DatabaseExportResult> {
  let tempDir: string | null = null
  let outputPath: string | null = null

  try {
    const defaultPath = path.join(
      app.getPath('documents'),
      buildTimestampedZipName('memorylane-db-export'),
    )
    const saveResult = await showSaveDialog(parentWindow, {
      title: 'Export Database ZIP',
      defaultPath,
      buttonLabel: 'Export',
      filters: [{ name: 'ZIP Archives', extensions: ['zip'] }],
    })

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, cancelled: true }
    }

    outputPath = ensureZipExtension(saveResult.filePath)
    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'memorylane-db-export-'))
    const dbBasename = path.basename(storage.getDbPath())
    const backupPath = path.join(tempDir, dbBasename)

    await storage.backupToFile(backupPath)
    await createZipWithFiles([backupPath], outputPath)

    return { success: true, outputPath }
  } catch (error) {
    log.error('[DatabaseExport] Error exporting database ZIP:', error)

    try {
      if (outputPath && fs.existsSync(outputPath)) {
        await fsPromises.rm(outputPath, { force: true })
      }
    } catch (cleanupError) {
      log.warn('[DatabaseExport] Failed to remove partial export ZIP:', cleanupError)
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  } finally {
    if (tempDir) {
      try {
        await fsPromises.rm(tempDir, { recursive: true, force: true })
      } catch (cleanupError) {
        log.warn('[DatabaseExport] Failed to clean temp export directory:', cleanupError)
      }
    }
  }
}
