import log from '@main/utils/logger'
import type { RemoteModelConfig } from '../../shared/remote-model-config'
import { coerceRemoteModelConfig } from './remote-model-config-store'

// Poll cadence for the model pipeline config. The point of remote config is
// that a degraded/repriced model can be swapped out within minutes, not on the
// next app update — 5 minutes bounds that lag while a no-change sync stays a
// cheap GET of a tiny static payload.
const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000

export interface RemoteModelConfigServiceParams {
  getDeviceId: () => string
  /** Gates syncing entirely: requires a managed OpenRouter key (plus
   * enterprise activation in that edition). BYOK/custom installs never poll. */
  isActivated: () => boolean
  getBackendUrl: () => string
  /** Fired when the config changes (including the cached load on start()). */
  onChange: (config: RemoteModelConfig) => void
  /** Last-known config cached on disk, or null. Loaded on start() so a restart
   * applies before the first network sync. */
  readStored?: () => RemoteModelConfig | null
  /** Persists the latest config so it survives restarts and backend outages. */
  writeStored?: (config: RemoteModelConfig) => void
  intervalMs?: number
}

/**
 * Polls the backend's model pipeline config (`GET api/config/models`) on a
 * timer and caches it to a dedicated file (never the user's settings). The
 * apply layer decides what to overwrite based on the config's version.
 *
 * The cache is durable: loaded on start() and replaced only by a clean HTTP 200
 * with a valid body. Any failure (4xx/5xx incl. a not-yet-deployed 404, network
 * error, malformed JSON) is logged and keeps the cache.
 */
export class RemoteModelConfigService {
  private readonly getDeviceId: () => string
  private readonly isActivated: () => boolean
  private readonly getBackendUrl: () => string
  private readonly onChange: (config: RemoteModelConfig) => void
  private readonly readStored?: () => RemoteModelConfig | null
  private readonly writeStored?: (config: RemoteModelConfig) => void
  private readonly intervalMs: number

  private config: RemoteModelConfig | null = null
  private serialized = ''
  private timer: ReturnType<typeof setInterval> | null = null
  private syncing = false

  constructor(params: RemoteModelConfigServiceParams) {
    this.getDeviceId = params.getDeviceId
    this.isActivated = params.isActivated
    this.getBackendUrl = params.getBackendUrl
    this.onChange = params.onChange
    this.readStored = params.readStored
    this.writeStored = params.writeStored
    this.intervalMs = params.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS
  }

  getConfig(): RemoteModelConfig | null {
    return this.config
  }

  start(): void {
    if (this.timer !== null) return
    this.loadCached()
    this.timer = setInterval(() => void this.sync(), this.intervalMs)
    this.timer.unref?.()
    void this.sync()
  }

  /** Applies the on-disk config ahead of the first sync, so a restart doesn't
   * wait on the network. Missing/corrupt cache is a no-op. */
  private loadCached(): void {
    const cached = this.readStored?.()
    if (!cached) return
    this.config = cached
    this.serialized = JSON.stringify(cached)
    log.info(`[RemoteModelConfig] Loaded cached config v${cached.version}`)
    this.onChange(cached)
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** One sync pass. Skips while a prior pass is in flight or the device isn't
   * activated; updates the held config and notifies only on a real change. */
  async sync(): Promise<void> {
    if (this.syncing || !this.isActivated()) return
    const base = this.getBackendUrl()
    if (!base) return
    this.syncing = true
    try {
      const next = await this.fetchConfig(base)
      const serialized = JSON.stringify(next)
      if (serialized === this.serialized) return
      this.config = next
      this.serialized = serialized
      this.writeStored?.(next)
      log.info(
        `[RemoteModelConfig] Synced config v${next.version} ` +
          `(${Object.keys(next.models).length} slots)`,
      )
      this.onChange(next)
    } catch (error) {
      log.warn('[RemoteModelConfig] Sync failed:', error)
    } finally {
      this.syncing = false
    }
  }

  private async fetchConfig(base: string): Promise<RemoteModelConfig> {
    const url = new URL('api/config/models', base.replace(/\/?$/, '/'))
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.getDeviceId()}` },
    })
    // Any non-200 is a failure: the sync loop swallows the throw and keeps the
    // last-known config. Only a clean 200 with a valid body replaces it.
    if (!response.ok) {
      throw new Error(`Remote model config request failed (${response.status})`)
    }
    const config = coerceRemoteModelConfig(await response.json())
    if (config === null) {
      throw new Error('Remote model config response is malformed')
    }
    return config
  }
}
