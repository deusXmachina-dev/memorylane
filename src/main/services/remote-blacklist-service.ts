import log from '../logger'
import type { ManagedExclusions } from '../../shared/types'
import { ENTERPRISE_BACKEND_CONFIG } from '../../shared/constants'
import { coerceManagedExclusions } from './remote-blacklist-store'

const EMPTY: ManagedExclusions = { apps: [], urlPatterns: [] }

// Poll cadence for the tenant blacklist. Cheap, since a sync only notifies on a
// real change. Shares the enterprise status-refresh interval (5 min) — IT edits
// the policy rarely, so there's no need to poll more often.
const DEFAULT_SYNC_INTERVAL_MS = ENTERPRISE_BACKEND_CONFIG.STATUS_REFRESH_INTERVAL_MS

function serialize(blacklist: ManagedExclusions): string {
  return JSON.stringify([blacklist.apps, blacklist.urlPatterns])
}

export interface RemoteBlacklistServiceParams {
  getDeviceId: () => string
  isActivated: () => boolean
  getBackendUrl: () => string
  /** Fired when the blacklist changes (including the first fetch); the
   * coordinator unions it with the user's list. */
  onChange: (blacklist: ManagedExclusions) => void
  /** Last-known blacklist cached on disk, or null. Loaded on start() so a
   * restart enforces before the first network sync. */
  readStored?: () => ManagedExclusions | null
  /** Persists the latest blacklist so it survives restarts and backend outages. */
  writeStored?: (blacklist: ManagedExclusions) => void
  intervalMs?: number
}

/**
 * Polls the tenant's centralized blacklist on a timer and caches it to a
 * dedicated file (never the user's settings). The coordinator unions it with the
 * user's exclusions, so managed entries are always enforced and not removable.
 *
 * The cache is durable: loaded on start() and replaced only by a clean HTTP 200.
 * Any failure (4xx/5xx, network, even 401) is logged and keeps the cache, so a
 * backend blip never drops the blacklist. Only a 200 with an empty list clears it.
 */
export class RemoteBlacklistService {
  private readonly getDeviceId: () => string
  private readonly isActivated: () => boolean
  private readonly getBackendUrl: () => string
  private readonly onChange: (blacklist: ManagedExclusions) => void
  private readonly readStored?: () => ManagedExclusions | null
  private readonly writeStored?: (blacklist: ManagedExclusions) => void
  private readonly intervalMs: number

  private blacklist: ManagedExclusions = EMPTY
  private serialized = serialize(EMPTY)
  private timer: ReturnType<typeof setInterval> | null = null
  private syncing = false

  constructor(params: RemoteBlacklistServiceParams) {
    this.getDeviceId = params.getDeviceId
    this.isActivated = params.isActivated
    this.getBackendUrl = params.getBackendUrl
    this.onChange = params.onChange
    this.readStored = params.readStored
    this.writeStored = params.writeStored
    this.intervalMs = params.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS
  }

  getBlacklist(): ManagedExclusions {
    return this.blacklist
  }

  start(): void {
    if (this.timer !== null) return
    this.loadCached()
    this.timer = setInterval(() => void this.sync(), this.intervalMs)
    this.timer.unref?.()
    void this.sync()
  }

  /** Enforces the on-disk blacklist ahead of the first sync, so a restart has no
   * blacklist-free window. Missing/empty cache is a no-op. */
  private loadCached(): void {
    const cached = this.readStored?.()
    if (!cached) return
    const serialized = serialize(cached)
    if (serialized === this.serialized) return
    this.blacklist = cached
    this.serialized = serialized
    log.info(
      `[RemoteBlacklist] Loaded cached blacklist: ${cached.apps.length} apps, ` +
        `${cached.urlPatterns.length} url patterns`,
    )
    this.onChange(cached)
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** One sync pass. Skips while a prior pass is in flight or the device isn't
   * activated; updates the held blacklist and notifies only on a real change. */
  async sync(): Promise<void> {
    if (this.syncing || !this.isActivated()) return
    this.syncing = true
    try {
      const next = await this.fetchBlacklist()
      const serialized = serialize(next)
      if (serialized === this.serialized) return
      this.blacklist = next
      this.serialized = serialized
      this.writeStored?.(next)
      log.info(
        `[RemoteBlacklist] Synced centralized blacklist: ${next.apps.length} apps, ` +
          `${next.urlPatterns.length} url patterns`,
      )
      this.onChange(next)
    } catch (error) {
      log.warn('[RemoteBlacklist] Sync failed:', error)
    } finally {
      this.syncing = false
    }
  }

  private async fetchBlacklist(): Promise<ManagedExclusions> {
    const base = this.getBackendUrl().replace(/\/?$/, '/')
    const url = new URL('api/license/blacklist', base)
    // Narrow app tokens to this platform's identifiers (macOS bundle ids vs.
    // Windows process names); the device can't match the other's.
    const platform =
      process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : null
    if (platform) url.searchParams.set('platform', platform)
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.getDeviceId()}` },
    })
    // Any non-200 (including 401) is a failure: the sync loop swallows the throw
    // and keeps the last-known blacklist. Only a clean 200 replaces it.
    if (!response.ok) {
      throw new Error(`Remote blacklist request failed (${response.status})`)
    }
    const data = (await response.json()) as {
      excludedApps?: unknown
      excludedUrlPatterns?: unknown
    }
    return coerceManagedExclusions(data.excludedApps, data.excludedUrlPatterns)
  }
}
