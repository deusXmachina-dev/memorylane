import * as fs from 'fs'
import * as path from 'path'
import log from '../logger'
import type { BlacklistSnapshot } from '../../shared/types'

const FILE_NAME = 'remote-blacklist.json'

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/**
 * Coerces untrusted app/url-pattern values (from disk or the backend) into a
 * sanitized {@link BlacklistSnapshot}. The single source of truth for turning
 * an unknown payload into a blacklist.
 */
export function coerceBlacklistSnapshot(apps: unknown, urlPatterns: unknown): BlacklistSnapshot {
  return { apps: toStringArray(apps), urlPatterns: toStringArray(urlPatterns) }
}

function defaultPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron') as typeof import('electron')
  return path.join(electron.app.getPath('userData'), FILE_NAME)
}

/**
 * Reads the last-known remote (org) blacklist cached on disk. Returns null when
 * the file is missing or unreadable/corrupt, so callers treat it as "no cached
 * blacklist" and fall back to waiting for a fresh sync. Entries are sanitized to
 * string arrays in case the file was hand-edited or written by an older build.
 */
export function readRemoteBlacklist(filePath: string = defaultPath()): BlacklistSnapshot | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as { apps?: unknown; urlPatterns?: unknown }
    return coerceBlacklistSnapshot(data.apps, data.urlPatterns)
  } catch {
    return null
  }
}

/**
 * Persists the latest remote (org) blacklist. Failures are swallowed (logged) —
 * a disk hiccup must never break the sync loop.
 */
export function writeRemoteBlacklist(
  snapshot: BlacklistSnapshot,
  filePath: string = defaultPath(),
): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2))
  } catch (error) {
    log.warn('[RemoteBlacklist] Failed to persist blacklist:', error)
  }
}
