import { app, dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import path from 'node:path'
import log from '../logger'
import { buildTimestampedZipName, createZipWithFiles, ensureZipExtension } from './zip'
import type { DatabaseExportResult } from '../../shared/types'

interface ExportLogsZipOptions {
  parentWindow?: BrowserWindow | null
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

/**
 * Diagnostic stats files that ship alongside the logs in both the manual export
 * ZIP and the automatic backend upload. Kept as a single source of truth so the
 * two bundles never drift. Each is included only when it exists.
 *
 * - `summary-mode-stats.json` — the video→snapshot fallback cause distribution
 *   (SummaryModeTracker): which mode/reason produced each summary, plus one raw
 *   failure sample per reason. The "mode failures" signal for debugging degraded
 *   summary quality.
 * - `usage-stats.json` — aggregate usage counters (UsageTracker).
 */
export function collectDiagnosticExtras(): string[] {
  const userData = app.getPath('userData')
  return ['summary-mode-stats.json', 'usage-stats.json']
    .map((name) => path.join(userData, name))
    .filter((filePath) => fs.existsSync(filePath))
}

/**
 * The full support-bundle file list: every rotated log file plus the diagnostic
 * stats. Single source of truth so the manual export ZIP and the automatic
 * backend upload always bundle the same set.
 */
export function collectSupportBundleFiles(): string[] {
  return [...collectLogFiles(resolveLogDir()), ...collectDiagnosticExtras()]
}

/**
 * Resolve the directory electron-log writes to. Falls back to Electron's
 * default logs path if the transport hasn't materialised a file yet.
 */
export function resolveLogDir(): string {
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
      buildTimestampedZipName('memorylane-logs-export'),
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
    // Snapshot: the active log file is appended to while we zip, and yazl's
    // streaming addFile would throw on the resulting size mismatch.
    await createZipWithFiles(collectSupportBundleFiles(), outputPath, { snapshot: true })

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
