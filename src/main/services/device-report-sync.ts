import log from '@main/utils/logger'
import type { AppEdition } from '../../shared/edition'
import type { DeviceReportState } from './device-report-store'

// Retry cadence for a report that hasn't landed yet. Once the running version is
// confirmed reported, every tick is a cheap no-op, so an hourly retry is plenty
// to recover from a backend outage at startup without adding traffic.
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

function currentPlatform(): string {
  // Match the token vocabulary the backend expects (mirrors the mapping in
  // remote-blacklist-service.ts).
  return process.platform === 'darwin'
    ? 'macos'
    : process.platform === 'win32'
      ? 'windows'
      : process.platform
}

export interface DeviceReportSyncParams {
  getDeviceId: () => string
  getBackendUrl: () => string
  getVersion: () => string
  edition: AppEdition
  /** Last version confirmed by the backend, loaded on start(). */
  readStored?: () => DeviceReportState | null
  /** Persists the confirmed version so the reporter stays quiet across restarts. */
  writeStored?: (state: DeviceReportState) => void
  intervalMs?: number
}

/**
 * Reports the running app version to the backend so the fleet's version
 * distribution is visible server-side. Runs in both editions (device identity is
 * edition-agnostic) and is not gated on activation or sync settings — the version
 * is low-sensitivity and we want accurate install-base counts.
 *
 * It reports at startup and thereafter only when the version differs from the
 * last one the backend confirmed. A failed report leaves the marker un-advanced,
 * so the timer retries until one lands; after that every tick is a no-op.
 */
export class DeviceReportSync {
  private readonly getDeviceId: () => string
  private readonly getBackendUrl: () => string
  private readonly getVersion: () => string
  private readonly edition: AppEdition
  private readonly readStored?: () => DeviceReportState | null
  private readonly writeStored?: (state: DeviceReportState) => void
  private readonly intervalMs: number

  private lastReported: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private syncing = false

  constructor(params: DeviceReportSyncParams) {
    this.getDeviceId = params.getDeviceId
    this.getBackendUrl = params.getBackendUrl
    this.getVersion = params.getVersion
    this.edition = params.edition
    this.readStored = params.readStored
    this.writeStored = params.writeStored
    this.intervalMs = params.intervalMs ?? DEFAULT_INTERVAL_MS
  }

  start(): void {
    if (this.timer !== null) return
    this.lastReported = this.readStored?.()?.version ?? null
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

  /** One report pass. Skips while a prior pass is in flight, the backend URL is
   * unset, or the running version was already confirmed; on a clean 200 it
   * records the version so subsequent passes go quiet. */
  async sync(): Promise<void> {
    if (this.syncing) return
    const base = this.getBackendUrl()
    if (!base) return
    const version = this.getVersion()
    if (version === this.lastReported) return

    this.syncing = true
    try {
      const url = new URL('api/device/report', base.replace(/\/?$/, '/'))
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.getDeviceId()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ version, platform: currentPlatform(), edition: this.edition }),
      })
      // Any non-200 is a failure: leave lastReported un-advanced so the next tick
      // retries. Only a clean 200 records the version.
      if (!response.ok) {
        throw new Error(`Device report failed (${response.status})`)
      }
      this.lastReported = version
      this.writeStored?.({ version })
      log.info(`[DeviceReport] Reported version ${version} (${this.edition})`)
    } catch (error) {
      log.warn('[DeviceReport] Report failed:', error)
    } finally {
      this.syncing = false
    }
  }
}
