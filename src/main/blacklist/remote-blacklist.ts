import log from '../logger'
import type { BlacklistSnapshot } from '../../shared/types'
import {
  coerceBlacklistSnapshot,
  readRemoteBlacklist,
  writeRemoteBlacklist,
} from './remote-blacklist-store'
import { Blacklist } from './blacklist'

const EMPTY: BlacklistSnapshot = { apps: [], urlPatterns: [] }

// Poll cadence for the tenant blacklist. Cheap, since a sync only notifies on a
// real change. Matches the enterprise status-refresh interval.
const DEFAULT_SYNC_INTERVAL_MS = 0.5 * 60 * 1000

function serialize(snapshot: BlacklistSnapshot): string {
  return JSON.stringify([snapshot.apps, snapshot.urlPatterns])
}

export interface RemoteBlacklistParams {
  getDeviceId: () => string
  isActivated: () => boolean
  getBackendUrl: () => string
  /** Last-known blacklist cached on disk, or null. Loaded on start() so a
   * restart enforces before the first network sync. Defaults to the on-disk
   * remote-blacklist store. */
  readStored?: () => BlacklistSnapshot | null
  /** Persists the latest blacklist so it survives restarts and backend outages. */
  writeStored?: (snapshot: BlacklistSnapshot) => void
  intervalMs?: number
}

/**
 * The org's centrally-synced capture blacklist (enterprise only). Polls the
 * tenant blacklist on a timer and caches it to a dedicated file (never the
 * user's settings). The coordinator unions it with the user's own exclusions,
 * so managed entries are always enforced and not removable.
 *
 * The cache is durable: loaded on start() and replaced only by a clean HTTP 200.
 * Any failure (4xx/5xx, network, even 401) is logged and keeps the cache, so a
 * backend blip never drops the blacklist. Only a 200 with an empty list clears it.
 */
export class RemoteBlacklist extends Blacklist {
  private readonly getDeviceId: () => string
  private readonly isActivated: () => boolean
  private readonly getBackendUrl: () => string
  private readonly readStored: () => BlacklistSnapshot | null
  private readonly writeStored: (snapshot: BlacklistSnapshot) => void
  private readonly intervalMs: number

  private current: BlacklistSnapshot = EMPTY
  private serialized = serialize(EMPTY)
  private timer: ReturnType<typeof setInterval> | null = null
  private syncing = false

  constructor(params: RemoteBlacklistParams) {
    super()
    this.getDeviceId = params.getDeviceId
    this.isActivated = params.isActivated
    this.getBackendUrl = params.getBackendUrl
    this.readStored = params.readStored ?? (() => readRemoteBlacklist())
    this.writeStored = params.writeStored ?? ((snapshot) => writeRemoteBlacklist(snapshot))
    this.intervalMs = params.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS
  }

  getBlacklistedApps(): string[] {
    return this.current.apps
  }

  getBlacklistedUrls(): string[] {
    return this.current.urlPatterns
  }

  start(): void {
    if (this.timer !== null) return
    this.loadCached()
    this.timer = setInterval(() => void this.sync(), this.intervalMs)
    this.timer.unref?.()
    void this.sync()
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  override dispose(): void {
    this.stop()
    super.dispose()
  }

  /** Enforces the on-disk blacklist ahead of the first sync, so a restart has no
   * blacklist-free window. Missing/empty cache is a no-op. */
  private loadCached(): void {
    const cached = this.readStored()
    if (!cached) return
    const serialized = serialize(cached)
    if (serialized === this.serialized) return
    this.current = cached
    this.serialized = serialized
    log.info(
      `[RemoteBlacklist] Loaded cached blacklist: ${cached.apps.length} apps, ` +
        `${cached.urlPatterns.length} url patterns`,
    )
    this.emit()
  }

  /** One sync pass. Skips while a prior pass is in flight or the device isn't
   * activated; updates the held blacklist and notifies only on a real change. */
  async sync(): Promise<void> {
    if (this.syncing || !this.isActivated()) return
    this.syncing = true
    try {
      const next = await this.fetchRemote()
      const serialized = serialize(next)
      if (serialized === this.serialized) return
      this.current = next
      this.serialized = serialized
      this.writeStored(next)
      log.info(
        `[RemoteBlacklist] Synced centralized blacklist: ${next.apps.length} apps, ` +
          `${next.urlPatterns.length} url patterns`,
      )
      this.emit()
    } catch (error) {
      log.warn('[RemoteBlacklist] Sync failed:', error)
    } finally {
      this.syncing = false
    }
  }

  private async fetchRemote(): Promise<BlacklistSnapshot> {
    const base = this.getBackendUrl().replace(/\/?$/, '/')
    // The endpoint path is the backend contract; the excludedApps/
    // excludedUrlPatterns response keys are the server's response shape.
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
    return coerceBlacklistSnapshot(data.excludedApps, data.excludedUrlPatterns)
  }
}
