import log from '@main/utils/logger'
import { backendPlatformToken } from '@main/utils/platform'
import type { AppEdition } from '../../shared/edition'
import type { DeviceReportState } from './device-report-store'
import { BACKEND_REQUEST_TIMEOUT_MS } from '../../shared/constants'

// Retry cadence for a report that hasn't landed yet. Once the running version is
// confirmed reported, every tick is a cheap no-op, so an hourly retry is plenty
// to recover from a backend outage at startup without adding traffic.
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

export interface DeviceReportSyncParams {
  getDeviceId: () => string
  /** Enterprise gates on activation; customer always reports (install-base count). */
  isActivated: () => boolean
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
 * distribution is visible server-side. Gated on `isActivated()` (enterprise waits
 * for activation; customer always reports). Reports on change only; a failed or
 * inactive pass leaves the marker un-advanced so the timer retries until it lands.
 */
export class DeviceReportSync {
  private readonly getDeviceId: () => string
  private readonly isActivated: () => boolean
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
    this.isActivated = params.isActivated
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

  /** One report pass; no-ops unless activated, configured, and on a new version. */
  async sync(): Promise<void> {
    if (this.syncing || !this.isActivated()) return
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
        body: JSON.stringify({ app_version: version, platform: backendPlatformToken() }),
        signal: AbortSignal.timeout(BACKEND_REQUEST_TIMEOUT_MS),
      })
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
