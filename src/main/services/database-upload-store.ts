import * as fs from 'fs'
import * as path from 'path'
import log from '@main/utils/logger'

const FILE_NAME = 'database-upload-state.json'

function defaultPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron') as typeof import('electron')
  return path.join(electron.app.getPath('userData'), FILE_NAME)
}

export function readResetRequestedAt(filePath: string = defaultPath()): number | null {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { resetRequestedAt?: unknown }
    return typeof data.resetRequestedAt === 'number' ? data.resetRequestedAt : null
  } catch {
    return null
  }
}

export function writeResetRequestedAt(
  resetRequestedAt: number | null,
  filePath: string = defaultPath(),
): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify({ resetRequestedAt }, null, 2))
  } catch (error) {
    log.warn('[DatabaseUpload] Failed to persist upload state:', error)
  }
}
