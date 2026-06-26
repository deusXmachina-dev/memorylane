import * as fs from 'fs'
import * as path from 'path'
import log from '../logger'
import type { ManagedExclusions } from '../../shared/types'

const FILE_NAME = 'managed-capture-policy.json'

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function defaultPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron') as typeof import('electron')
  return path.join(electron.app.getPath('userData'), FILE_NAME)
}

/**
 * Reads the last-known centralized capture blacklist cached on disk. Returns
 * null when the file is missing or unreadable/corrupt, so callers treat it as
 * "no cached policy" and fall back to waiting for a fresh sync. Entries are
 * sanitized to string arrays in case the file was hand-edited or written by an
 * older build.
 */
export function readManagedCapturePolicy(
  filePath: string = defaultPath(),
): ManagedExclusions | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as { apps?: unknown; urlPatterns?: unknown }
    return {
      apps: toStringArray(data.apps),
      urlPatterns: toStringArray(data.urlPatterns),
    }
  } catch {
    return null
  }
}

/**
 * Persists the latest centralized capture blacklist. Failures are swallowed
 * (logged) — a disk hiccup must never break the policy sync loop.
 */
export function writeManagedCapturePolicy(
  policy: ManagedExclusions,
  filePath: string = defaultPath(),
): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(policy, null, 2))
  } catch (error) {
    log.warn('[CapturePolicy] Failed to persist centralized blacklist:', error)
  }
}
