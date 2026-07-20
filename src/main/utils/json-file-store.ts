import * as fs from 'fs'
import * as path from 'path'
import log from '@main/utils/logger'

export interface JsonFileStore<T> {
  read: (filePath?: string) => T | null
  write: (value: T, filePath?: string) => void
}

/**
 * Read/write helpers for a JSON cache file in the app's userData directory.
 * `read` returns null when the file is missing or unreadable/corrupt, so
 * callers fall back to their defaults; `write` failures are swallowed (logged)
 * — a disk hiccup must never break a sync loop.
 */
export function createUserDataJsonStore<T>(
  fileName: string,
  tag: string,
  coerce: (data: unknown) => T | null,
): JsonFileStore<T> {
  const defaultPath = (): string => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as typeof import('electron')
    return path.join(electron.app.getPath('userData'), fileName)
  }
  return {
    read(filePath = defaultPath()) {
      try {
        return coerce(JSON.parse(fs.readFileSync(filePath, 'utf-8')))
      } catch {
        return null
      }
    },
    write(value, filePath = defaultPath()) {
      try {
        fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
      } catch (error) {
        log.warn(`[${tag}] Failed to persist ${fileName}:`, error)
      }
    },
  }
}
