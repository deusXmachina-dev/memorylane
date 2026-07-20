import { createUserDataJsonStore } from '@main/utils/json-file-store'
import type { ManagedExclusions } from '../../shared/types'

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/**
 * Coerces untrusted app/url-pattern values (from disk or the backend) into a
 * sanitized {@link ManagedExclusions}. The single source of truth for turning
 * an unknown payload into a remote blacklist.
 */
export function coerceManagedExclusions(apps: unknown, urlPatterns: unknown): ManagedExclusions {
  return { apps: toStringArray(apps), urlPatterns: toStringArray(urlPatterns) }
}

// Entries are sanitized to string arrays in case the file was hand-edited or
// written by an older build.
const store = createUserDataJsonStore('remote-blacklist.json', 'RemoteBlacklist', (data) => {
  const { apps, urlPatterns } = data as { apps?: unknown; urlPatterns?: unknown }
  return coerceManagedExclusions(apps, urlPatterns)
})

export const readRemoteBlacklist = store.read
export const writeRemoteBlacklist = store.write
