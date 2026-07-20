import log from '@main/utils/logger'

export interface RemoteSyncServiceParams<T> {
  getDeviceId: () => string
  /** Gates syncing entirely; polling is skipped while it returns false. */
  isActivated: () => boolean
  getBackendUrl: () => string
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
  private timer: ReturnType<typeof setInterval> | null = null
  private syncing = false
  private readonly intervalMs: number

  protected constructor(
    private readonly tag: string,
    private readonly params: RemoteSyncServiceParams<T>,
    defaultIntervalMs: number,
  ) {
    this.intervalMs = params.intervalMs ?? defaultIntervalMs
    const cached = params.readStored?.()
    if (cached) {
      this.value = cached
      this.serialized = this.serialize(cached)
      this.cachePending = true
      log.info(`[${tag}] Loaded cached ${this.describe(cached)}`)
    }
  }

  /** Fetch and parse the remote value; throw on anything but a clean result. */
  protected abstract fetchRemote(base: string): Promise<T>
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
    if (this.timer !== null) return
    // Broadcast the cached value ahead of the first network sync, so a restart
    // doesn't wait on the network.
    if (this.cachePending && this.value !== null) {
      this.cachePending = false
      this.params.onChange(this.value)
    }
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

  /** One sync pass. Skips while a prior pass is in flight or the device isn't
   * activated; updates the held value and notifies only on a real change. */
  async sync(): Promise<void> {
    if (this.syncing || !this.params.isActivated()) return
    const base = this.params.getBackendUrl()
    if (!base) return
    this.syncing = true
    try {
      const next = await this.fetchRemote(base)
      const serialized = this.serialize(next)
      if (serialized === this.serialized) return
      this.value = next
      this.serialized = serialized
      this.params.writeStored?.(next)
      log.info(`[${this.tag}] Synced ${this.describe(next)}`)
      this.params.onChange(next)
    } catch (error) {
      log.warn(`[${this.tag}] Sync failed:`, error)
    } finally {
      this.syncing = false
    }
  }

  /** Resolves an endpoint path against the backend base URL. */
  protected endpoint(base: string, path: string): URL {
    return new URL(path, base.replace(/\/?$/, '/'))
  }

  /** GET with the device bearer. Any non-200 throws, so the sync loop swallows
   * it and keeps the last-known value; only a clean 200 replaces it. */
  protected async fetchJson(url: URL): Promise<unknown> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.params.getDeviceId()}` },
    })
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`)
    }
    return response.json()
  }
}
