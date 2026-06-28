import * as fs from 'fs'
import * as path from 'path'
import log from '../logger'

const FILE_NAME = 'log-upload-state.json'

/**
 * Marker tracking the last successful log upload, persisted so change-detection
 * and the upload throttle survive restarts.
 */
export interface LogUploadState {
  /** Unix ms of the last successful upload, or null if never uploaded. */
  lastUploadAt: number | null
  /** Signature of the log bundle at the last successful upload, or null. */
  lastSig: string | null
}

function defaultPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron') as typeof import('electron')
  return path.join(electron.app.getPath('userData'), FILE_NAME)
}

/**
 * Reads the last-upload marker from disk. Returns null when the file is missing
 * or unreadable/corrupt, so callers treat it as "never uploaded" and upload on
 * the next pass. Fields are sanitized in case the file was hand-edited or
 * written by an older build.
 */
export function readLogUploadState(filePath: string = defaultPath()): LogUploadState | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as { lastUploadAt?: unknown; lastSig?: unknown }
    return {
      lastUploadAt: typeof data.lastUploadAt === 'number' ? data.lastUploadAt : null,
      lastSig: typeof data.lastSig === 'string' ? data.lastSig : null,
    }
  } catch {
    return null
  }
}

/**
 * Persists the last-upload marker. Failures are swallowed (logged) — a disk
 * hiccup must never break the upload loop.
 */
export function writeLogUploadState(state: LogUploadState, filePath: string = defaultPath()): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2))
  } catch (error) {
    log.warn('[LogUpload] Failed to persist upload state:', error)
  }
}
