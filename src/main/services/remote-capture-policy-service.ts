import log from '../logger'
import type { ManagedExclusions } from '../../shared/types'

const EMPTY: ManagedExclusions = { apps: [], urlPatterns: [] }

// Poll cadence for pulling the tenant's centralized blacklist. Aligned with the
// enterprise status-refresh interval so a device converges on an IT edit within
// roughly one refresh. The sync is idempotent and only notifies on a real
// change, so polling costs little.
const DEFAULT_SYNC_INTERVAL_MS = 0.5 * 60 * 1000

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function serialize(policy: ManagedExclusions): string {
  return JSON.stringify([policy.apps, policy.urlPatterns])
}

export interface RemoteCapturePolicyServiceParams {
  getDeviceId: () => string
  isActivated: () => boolean
  getBackendUrl: () => string
  /** Fired with the new policy whenever it actually changes (including the first
   * successful fetch). The blacklist coordinator unions it with the user's list. */
  onChange: (policy: ManagedExclusions) => void
  intervalMs?: number
}

/**
 * Pulls the tenant's centralized capture blacklist (DEU-166) on a timer and
 * holds the latest copy in memory. It owns its own poll loop and never writes to
 * the user's local settings — the blacklist coordinator unions this with the
 * user's exclusions at capture time, so centrally-mandated entries are always
 * enforced and never user-removable.
 *
 * A failed sync is swallowed (logged) and leaves the last-known policy intact,
 * so a transient backend blip never drops the blacklist.
 */
export class RemoteCapturePolicyService {
  private readonly getDeviceId: () => string
  private readonly isActivated: () => boolean
  private readonly getBackendUrl: () => string
  private readonly onChange: (policy: ManagedExclusions) => void
  private readonly intervalMs: number

  private policy: ManagedExclusions = EMPTY
  private serialized = serialize(EMPTY)
  private timer: ReturnType<typeof setInterval> | null = null
  private syncing = false

  constructor(params: RemoteCapturePolicyServiceParams) {
    this.getDeviceId = params.getDeviceId
    this.isActivated = params.isActivated
    this.getBackendUrl = params.getBackendUrl
    this.onChange = params.onChange
    this.intervalMs = params.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS
  }

  getPolicy(): ManagedExclusions {
    return this.policy
  }

  start(): void {
    if (this.timer !== null) return
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
   * activated; updates the held policy and notifies only on a real change. */
  async sync(): Promise<void> {
    if (this.syncing || !this.isActivated()) return
    this.syncing = true
    try {
      const next = await this.fetchPolicy()
      const serialized = serialize(next)
      if (serialized === this.serialized) return
      this.policy = next
      this.serialized = serialized
      log.info(
        `[CapturePolicy] Synced centralized blacklist: ${next.apps.length} apps, ` +
          `${next.urlPatterns.length} url patterns`,
      )
      this.onChange(next)
    } catch (error) {
      log.warn('[CapturePolicy] Sync failed:', error)
    } finally {
      this.syncing = false
    }
  }

  private async fetchPolicy(): Promise<ManagedExclusions> {
    const base = this.getBackendUrl().replace(/\/?$/, '/')
    const url = new URL('api/license/capture-policy', base)
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.getDeviceId()}` },
    })
    // 401 = the device token isn't bound to a tenant (e.g. deactivated). Treat
    // as "no centralized policy" so enforcement stops rather than going stale.
    if (response.status === 401) {
      return EMPTY
    }
    if (!response.ok) {
      throw new Error(`Capture policy request failed (${response.status})`)
    }
    const data = (await response.json()) as {
      excludedApps?: unknown
      excludedUrlPatterns?: unknown
    }
    return {
      apps: toStringArray(data.excludedApps),
      urlPatterns: toStringArray(data.excludedUrlPatterns),
    }
  }
}
