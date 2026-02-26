import { app, dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as yazl from 'yazl'
import log from '../logger'
import type { DatabaseExportResult } from '../../shared/types'

export interface DatabaseExportStorage {
  getDbPath(): string
  backupToFile(destinationPath: string): Promise<void>
}

interface ExportDatabaseZipOptions {
  storage: DatabaseExportStorage
  parentWindow?: BrowserWindow | null
}

function pad2(v: number): string {
  return String(v).padStart(2, '0')
}

function buildDefaultDatabaseExportFilename(now = new Date()): string {
  const timestamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(
    now.getHours(),
  )}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  return `memorylane-db-export-${timestamp}.zip`
}

function ensureZipExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith('.zip') ? filePath : `${filePath}.zip`
}

async function createZipWithSingleFile(
  inputPath: string,
  entryName: string,
  outputZipPath: string,
): Promise<void> {
  await fsPromises.mkdir(path.dirname(outputZipPath), { recursive: true })

  await new Promise<void>((resolve, reject) => {
    const zipFile = new yazl.ZipFile()
    const output = fs.createWriteStream(outputZipPath)

    const onError = (error: unknown): void => {
      reject(error instanceof Error ? error : new Error(String(error)))
    }

    output.once('error', onError)
    zipFile.outputStream.once('error', onError)
    output.once('close', resolve)

    zipFile.outputStream.pipe(output)
    zipFile.addFile(inputPath, entryName)
    zipFile.end()
  })
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
      buildDefaultDatabaseExportFilename(new Date()),
    )
    const saveResult = await dialog.showSaveDialog(parentWindow ?? undefined, {
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
    await createZipWithSingleFile(backupPath, dbBasename, outputPath)

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
