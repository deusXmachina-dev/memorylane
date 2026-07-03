import * as fs from 'fs'
import * as path from 'path'
import log from '@main/utils/logger'

const FILE_NAME = 'device-report-state.json'

/**
 * Marker tracking the last app version successfully reported to the backend,
 * persisted so the reporter only re-POSTs on a genuine version change and stays
 * quiet across restarts.
 */
export interface DeviceReportState {
  /** The last app version confirmed by the backend, or null if never reported. */
  version: string | null
}

function defaultPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron') as typeof import('electron')
  return path.join(electron.app.getPath('userData'), FILE_NAME)
}

/**
 * Reads the last-reported marker from disk. Returns null when the file is
 * missing or unreadable/corrupt, so callers treat it as "never reported" and
 * report on the next pass. Fields are sanitized in case the file was hand-edited
 * or written by an older build.
 */
export function readDeviceReportState(filePath: string = defaultPath()): DeviceReportState | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as { version?: unknown }
    return {
      version: typeof data.version === 'string' ? data.version : null,
    }
  } catch {
    return null
  }
}

/**
 * Persists the last-reported marker. Failures are swallowed (logged) — a disk
 * hiccup must never break the report loop.
 */
export function writeDeviceReportState(
  state: DeviceReportState,
  filePath: string = defaultPath(),
): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2))
  } catch (error) {
    log.warn('[DeviceReport] Failed to persist report state:', error)
  }
}
