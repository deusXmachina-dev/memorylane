import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import log from '../logger'
import { LOG_UPLOAD_MIN_INTERVAL_MS } from '../../shared/constants'
import { collectSupportBundleFiles } from '../ui/logs-export'
import { createZipWithFiles } from '../ui/zip'
import type { LogUploadState } from './log-upload-store'

// Poll cadence, NOT the upload cadence. We check hourly whether the logs have
// changed and the throttle window has elapsed; uploads are bounded by
// LOG_UPLOAD_MIN_INTERVAL_MS and only fire when the bundle actually changed.
const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1000

/** Bundle the log files plus diagnostic stats into a zip at `outputPath`. */
export type ZipLogFiles = (files: string[], outputPath: string) => Promise<void>

export interface LogUploadSyncParams {
  getDeviceId: () => string
  isActivated: () => boolean
  isSyncEnabled: () => boolean
  getBackendUrl: () => string
  /** Last-upload marker on disk, or null if never uploaded. */
  readState: () => LogUploadState | null
  /** Persist the marker after a successful upload. */
  writeState: (state: LogUploadState) => void
  /** Collect the files to bundle (logs + diagnostic extras). Injectable for tests. */
  collectFiles?: () => string[]
  /** Zip the files. Defaults to a snapshotting zip; injectable for tests. */
  zipFiles?: ZipLogFiles
  intervalMs?: number
  /** Minimum elapsed time between uploads. Defaults to LOG_UPLOAD_MIN_INTERVAL_MS. */
  minIntervalMs?: number
  now?: () => number
}

/**
 * Periodically ships the app logs (and the diagnostic stats files) to the
 * enterprise backend for debugging. Mirrors {@link DatabaseUploadSync}: same
 * Bearer-deviceId auth, same multipart/`fetch` shape, same activation/sharing
 * gating.
 *
 * Uploads are change-gated and throttled: a signature over the bundle's
 * sizes/mtimes is compared to the last uploaded one, and at least
 * `minIntervalMs` must have elapsed since the last success. Any failure
 * (non-2xx, network) is logged and leaves the marker un-advanced, so the next
 * poll retries.
 */
export class LogUploadSync {
  private readonly getDeviceId: () => string
  private readonly isActivated: () => boolean
  private readonly isSyncEnabled: () => boolean
  private readonly getBackendUrl: () => string
  private readonly readState: () => LogUploadState | null
  private readonly writeState: (state: LogUploadState) => void
  private readonly collectFiles: () => string[]
  private readonly zipFiles: ZipLogFiles
  private readonly intervalMs: number
  private readonly minIntervalMs: number
  private readonly now: () => number

  private timer: ReturnType<typeof setInterval> | null = null
  // The current pass, or null when idle. Non-null also means "a pass is running"
  // for overlap guarding — settled state isn't synchronously pollable, so the
  // null/non-null flag stands in for it.
  private inFlight: Promise<void> | null = null

  constructor(params: LogUploadSyncParams) {
    this.getDeviceId = params.getDeviceId
    this.isActivated = params.isActivated
    this.isSyncEnabled = params.isSyncEnabled
    this.getBackendUrl = params.getBackendUrl
    this.readState = params.readState
    this.writeState = params.writeState
    this.collectFiles = params.collectFiles ?? collectSupportBundleFiles
    this.zipFiles =
      params.zipFiles ?? ((files, out) => createZipWithFiles(files, out, { snapshot: true }))
    this.intervalMs = params.intervalMs ?? DEFAULT_CHECK_INTERVAL_MS
    this.minIntervalMs = params.minIntervalMs ?? LOG_UPLOAD_MIN_INTERVAL_MS
    this.now = params.now ?? Date.now
  }

  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => this.requestSync('interval'), this.intervalMs)
    this.timer.unref?.()
    this.requestSync('startup')
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    await this.inFlight?.catch(() => undefined)
  }

  /** Kick off a sync pass if one isn't already running. */
  requestSync(reason: string): void {
    if (this.inFlight) return
    void this.run(reason, false).catch((error) => {
      log.warn(`[LogUpload] Sync failed (${reason}):`, error)
    })
  }

  /**
   * Force an upload now, bypassing the change/throttle gates (the "Sync now"
   * button). Returns the outcome so the UI can toast success/failure. Mirrors
   * DatabaseUploadSync.triggerUpload.
   */
  async triggerUpload(): Promise<{ success: boolean; error?: string }> {
    if (!this.isSyncEnabled()) {
      return { success: false, error: 'Sharing disabled' }
    }
    // Let any in-flight background pass finish so the two don't overlap.
    await this.inFlight?.catch(() => undefined)
    try {
      await this.run('manual', true)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Upload failed' }
    }
  }

  /**
   * Run a single pass and track it as `inFlight` (settling back to idle) so
   * overlapping passes are guarded and `stop`/`triggerUpload` can await it. The
   * raw pass is returned so callers see its rejection; `inFlight` swallows it.
   */
  private run(reason: string, force: boolean): Promise<void> {
    const pass = this.syncOnce(reason, force)
    this.inFlight = pass
      .catch(() => undefined)
      .finally(() => {
        this.inFlight = null
      })
    return pass
  }

  private async syncOnce(reason: string, force = false): Promise<void> {
    if (!this.isSyncEnabled()) {
      log.debug(`[LogUpload] Skipping (${reason}) — sharing disabled`)
      return
    }
    if (!this.isActivated()) {
      if (force) throw new Error('Device not activated')
      log.debug(`[LogUpload] Skipping (${reason}) — device not activated`)
      return
    }

    const files = this.collectFiles()
    if (files.length === 0) {
      if (force) throw new Error('No log files found')
      log.debug(`[LogUpload] Skipping (${reason}) — no log files`)
      return
    }

    const signature = this.computeSignature(files)
    // A manual trigger uploads regardless of whether the logs changed or when we
    // last uploaded; the automatic poll respects both gates.
    if (!force) {
      const state = this.readState()
      if (state?.lastSig === signature) {
        log.debug(`[LogUpload] Skipping (${reason}) — logs unchanged since last upload`)
        return
      }
      if (state?.lastUploadAt != null && this.now() - state.lastUploadAt < this.minIntervalMs) {
        log.debug(`[LogUpload] Skipping (${reason}) — throttled (uploaded recently)`)
        return
      }
    }

    const tempPath = path.join(os.tmpdir(), `.memorylane-logs-${process.pid}.${this.now()}.zip`)
    try {
      await this.zipFiles(files, tempPath)
      const zipBytes = await fsPromises.readFile(tempPath)

      const form = new FormData()
      form.append('file', new Blob([zipBytes]), 'memorylane-logs.zip')

      const base = this.getBackendUrl().replace(/\/?$/, '/')
      const url = new URL('api/device/logs', base)
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.getDeviceId()}` },
        body: form,
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`Log upload failed (${response.status}): ${body}`)
      }

      this.writeState({ lastUploadAt: this.now(), lastSig: signature })
      log.info(`[LogUpload] Upload succeeded (${reason}): ${files.length} file(s)`)
    } finally {
      try {
        fs.rmSync(tempPath, { force: true })
      } catch {
        // best-effort cleanup
      }
    }
  }

  /** Cheap change signature over the bundle: per-file size + mtime. */
  private computeSignature(files: string[]): string {
    return files
      .map((file) => {
        try {
          const stat = fs.statSync(file)
          return `${path.basename(file)}:${stat.size}:${Math.round(stat.mtimeMs)}`
        } catch {
          return `${path.basename(file)}:missing`
        }
      })
      .sort()
      .join('|')
  }
}
