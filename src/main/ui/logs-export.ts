import { app, dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import path from 'node:path'
import * as yazl from 'yazl'
import log from '../logger'
import type { DatabaseExportResult } from '../../shared/types'

interface ExportLogsZipOptions {
  parentWindow?: BrowserWindow | null
}

function pad2(v: number): string {
  return String(v).padStart(2, '0')
}

function buildDefaultLogsExportFilename(now = new Date()): string {
  const timestamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(
    now.getHours(),
  )}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  return `memorylane-logs-export-${timestamp}.zip`
}

function ensureZipExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith('.zip') ? filePath : `${filePath}.zip`
}

/**
 * Collect the absolute paths of every `*.log` file in `logDir` (so rotated
 * files like `main.old.log` ship alongside `main.log`). Returns an empty array
 * if the directory is missing or holds no log files.
 */
export function collectLogFiles(logDir: string): string[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(logDir)
  } catch {
    return []
  }
  return entries
    .filter((name) => name.toLowerCase().endsWith('.log'))
    .map((name) => path.join(logDir, name))
    .filter((filePath) => {
      try {
        return fs.statSync(filePath).isFile()
      } catch {
        return false
      }
    })
}

async function createZipWithFiles(inputPaths: string[], outputZipPath: string): Promise<void> {
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
    for (const inputPath of inputPaths) {
      zipFile.addFile(inputPath, path.basename(inputPath))
    }
    zipFile.end()
  })
}

/**
 * Resolve the directory electron-log writes to. Falls back to Electron's
 * default logs path if the transport hasn't materialised a file yet.
 */
function resolveLogDir(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electronLog = require('electron-log/main')
    const current: string | undefined = electronLog.transports?.file?.getFile?.()?.path
    if (current) {
      return path.dirname(current)
    }
  } catch (error) {
    log.warn('[LogsExport] Could not resolve electron-log file path:', error)
  }
  return app.getPath('logs')
}

export async function exportLogsZip({
  parentWindow = null,
}: ExportLogsZipOptions): Promise<DatabaseExportResult> {
  let outputPath: string | null = null

  try {
    const logFiles = collectLogFiles(resolveLogDir())
    if (logFiles.length === 0) {
      return { success: false, error: 'No log files found' }
    }

    const defaultPath = path.join(
      app.getPath('documents'),
      buildDefaultLogsExportFilename(new Date()),
    )
    const saveResult = await dialog.showSaveDialog(parentWindow ?? undefined, {
      title: 'Export Logs ZIP',
      defaultPath,
      buttonLabel: 'Export',
      filters: [{ name: 'ZIP Archives', extensions: ['zip'] }],
    })

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, cancelled: true }
    }

    outputPath = ensureZipExtension(saveResult.filePath)
    await createZipWithFiles(logFiles, outputPath)

    return { success: true, outputPath }
  } catch (error) {
    log.error('[LogsExport] Error exporting logs ZIP:', error)

    try {
      if (outputPath && fs.existsSync(outputPath)) {
        await fsPromises.rm(outputPath, { force: true })
      }
    } catch (cleanupError) {
      log.warn('[LogsExport] Failed to remove partial export ZIP:', cleanupError)
    }

    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  }
}

// Exported for testing.
export const __testing = { createZipWithFiles, buildDefaultLogsExportFilename, ensureZipExtension }
