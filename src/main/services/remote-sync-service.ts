import log from '@main/utils/logger'
import { BACKEND_REQUEST_TIMEOUT_MS } from '@/shared/constants'
import type { BackendClient } from './backend-client'
import { PeriodicJob } from './periodic-job'

export interface RemoteSyncServiceParams<T> {
  backend: BackendClient
  /** Gates syncing entirely; polling is skipped while it returns false. */
  isActivated: () => boolean
  /** Fired when the value changes (including the cached load on start()). */
  onChange: (value: T) => void
  /** Last-known value cached on disk, or null. Read in the constructor so the
   * value is available before start(); start() broadcasts it ahead of the
   * first network sync. */
  readStored?: () => T | null
  /** Persists the latest value so it survives restarts and backend outages. */
  writeStored?: (value: T) => void
  intervalMs?: number
}

/**
 * Base for services that poll a backend endpoint on a timer and cache the last
 * good value to a dedicated file (never the user's settings).
 *
 * The cache is durable: replaced only by a clean HTTP 200 with a valid body.
 * Any failure (4xx/5xx, network error, malformed JSON) is logged and keeps the
 * cache. Change detection is by serialized comparison, so onChange fires only
 * on a real change.
 */
export abstract class RemoteSyncService<T> {
  private value: T | null = null
  private serialized = ''
  private cachePending = false
  private readonly runner: PeriodicJob

  protected constructor(
    private readonly tag: string,
    private readonly params: RemoteSyncServiceParams<T>,
    defaultIntervalMs: number,
  ) {
    this.runner = new PeriodicJob({
      name: tag,
      intervalMs: params.intervalMs ?? defaultIntervalMs,
      run: (reason) => this.syncOnce(reason),
    })
    const cached = params.readStored?.()
    if (cached) {
      this.value = cached
      this.serialized = this.serialize(cached)
      this.cachePending = true
      log.info(`[${tag}] Loaded cached ${this.describe(cached)}`)
    }
  }

  /** Fetch and parse the remote value; throw on anything but a clean result. */
  protected abstract fetchRemote(): Promise<T>
  /** Short human description of a value, for log lines. */
  protected abstract describe(value: T): string
  /** Canonical form used for change detection. */
  protected serialize(value: T): string {
    return JSON.stringify(value)
  }

  protected getValue(): T | null {
    return this.value
  }

  start(): void {
    // Broadcast the cached value ahead of the first network sync, so a restart
    // doesn't wait on the network.
    if (this.cachePending && this.value !== null) {
      this.cachePending = false
      this.params.onChange(this.value)
    }
    this.runner.start()
  }

  stop(): Promise<void> {
    return this.runner.stop()
  }

  /** One sync pass, queued behind any pass in flight. */
  sync(): Promise<void> {
    return this.runner.run('manual')
  }

  private async syncOnce(reason: string): Promise<void> {
    if (!this.params.isActivated()) return
    const standDown = await this.params.backend.standDown()
    if (standDown !== null) {
      log.debug(`[${this.tag}] Skipping sync (${reason}) — ${standDown}`)
      return
    }
    const startedAt = Date.now()
    try {
      const next = await this.fetchRemote()
      const serialized = this.serialize(next)
      if (serialized === this.serialized) return
      this.value = next
      this.serialized = serialized
      this.params.writeStored?.(next)
      log.info(`[${this.tag}] Synced ${this.describe(next)}`)
      this.params.onChange(next)
    } catch (error) {
      if (this.params.backend.interrupted(startedAt, error)) {
        log.info(`[${this.tag}] Sync deferred (${reason}):`, error)
      } else {
        log.warn(`[${this.tag}] Sync failed (${reason}):`, error)
      }
    }
  }

  /** GET with the device bearer. Any non-200 throws, so the sync loop swallows
   * it and keeps the last-known value; only a clean 200 replaces it. */
  protected async fetchJson(path: string): Promise<unknown> {
    const response = await this.params.backend.request(path, {
      timeoutMs: BACKEND_REQUEST_TIMEOUT_MS,
    })
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`)
    }
    return response.json()
  }
}
