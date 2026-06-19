import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import log from '../logger'
import { isSameDay } from './pattern-detector/helpers'
import { type StripOptions } from './strip-database-for-upload'

const DEFAULT_UPLOAD_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Strip + VACUUM + gzip a backup DB into the bytes to upload. */
export type PrepareUpload = (tempPath: string, stripOptions: StripOptions) => Promise<Buffer>

// The default runs the prep in a short-lived utilityProcess: VACUUM and the
// column-drop rewrite are synchronous, CPU-heavy SQLite work and would freeze
// the UI if run on the main thread. Lazily imported so unit tests (which inject
// their own prepareUpload) never pull in electron.
const defaultPrepareUpload: PrepareUpload = async (tempPath, stripOptions) => {
  const { prepareUploadInWorker } = await import('./upload-prep')
  return prepareUploadInWorker(tempPath, stripOptions)
}

export interface DatabaseUploadStorage {
  backupToFile(destinationPath: string): Promise<void>
}

export interface DatabaseUploadSyncParams {
  storage: DatabaseUploadStorage
  getDeviceId: () => string
  isActivated: () => boolean
  isSyncEnabled: () => boolean
  getStripOptions: () => StripOptions
  getBackendUrl: () => string
  /** Timestamp (ms) of the last successful upload, or null if never. */
  getLastUploadAt: () => number | null
  /** Persist the timestamp (ms) of a successful upload. */
  recordUploadAt: (ts: number) => void
  intervalMs?: number
  /** Strip + compress the backup DB. Defaults to a utilityProcess worker;
   *  injectable so tests don't spawn a process. */
  prepareUpload?: PrepareUpload
}

export class DatabaseUploadSync {
  private readonly storage: DatabaseUploadStorage
  private readonly getDeviceId: () => string
  private readonly isActivated: () => boolean
  private readonly isSyncEnabled: () => boolean
  private readonly getStripOptions: () => StripOptions
  private readonly getBackendUrl: () => string
  private readonly getLastUploadAt: () => number | null
  private readonly recordUploadAt: (ts: number) => void
  private readonly intervalMs: number
  private readonly prepareUpload: PrepareUpload
  private timer: ReturnType<typeof setInterval> | null = null
  private uploadRunning = false
  private rerunRequested = false
  private inFlight: Promise<void> = Promise.resolve()

  constructor(params: DatabaseUploadSyncParams) {
    this.storage = params.storage
    this.getDeviceId = params.getDeviceId
    this.isActivated = params.isActivated
    this.isSyncEnabled = params.isSyncEnabled
    this.getStripOptions = params.getStripOptions
    this.getBackendUrl = params.getBackendUrl
    this.getLastUploadAt = params.getLastUploadAt
    this.recordUploadAt = params.recordUploadAt
    this.intervalMs = params.intervalMs ?? DEFAULT_UPLOAD_INTERVAL_MS
    this.prepareUpload = params.prepareUpload ?? defaultPrepareUpload
  }

  public start(): void {
    if (this.timer !== null) {
      return
    }

    this.timer = setInterval(() => {
      this.scheduleUploadIfStale('interval')
    }, this.intervalMs)
    this.timer.unref?.()

    this.scheduleUploadIfStale('startup')
  }

  /**
   * Upload if we haven't already uploaded today, otherwise skip. Call this on
   * startup and on power resume so uploads catch up regardless of how the
   * sleep-fragile 24h interval drifts. Unlike `triggerUpload`, this is gated —
   * it never forces a duplicate same-day upload.
   */
  public scheduleUploadIfStale(reason: string): void {
    const lastUploadAt = this.getLastUploadAt()
    if (lastUploadAt !== null && isSameDay(lastUploadAt, Date.now())) {
      log.debug(`[DatabaseUploadSync] Skipping upload (${reason}) — already uploaded today`)
      return
    }
    void this.queueUpload(reason)
  }

  public async triggerUpload(): Promise<{ success: boolean; error?: string }> {
    if (!this.isSyncEnabled()) {
      return { success: false, error: 'Sharing disabled' }
    }
    try {
      await this.queueUpload('manual')
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed'
      return { success: false, error: message }
    }
  }

  public async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }

    await this.inFlight.catch(() => undefined)
  }

  private async queueUpload(reason: string): Promise<void> {
    if (this.uploadRunning) {
      this.rerunRequested = true
      return this.inFlight
    }

    this.uploadRunning = true
    let nextReason = reason
    this.inFlight = (async () => {
      do {
        this.rerunRequested = false
        await this.uploadOnce(nextReason)
        nextReason = 'coalesced'
      } while (this.rerunRequested)
    })()
      .catch((error) => {
        log.error(`[DatabaseUploadSync] Upload failed (${reason}):`, error)
      })
      .finally(() => {
        this.uploadRunning = false
      })

    return this.inFlight
  }

  private async uploadOnce(reason: string): Promise<void> {
    if (!this.isSyncEnabled()) {
      log.debug('[DatabaseUploadSync] Skipping upload — sharing disabled')
      return
    }

    if (!this.isActivated()) {
      log.debug('[DatabaseUploadSync] Skipping upload — device not activated')
      return
    }

    const tempPath = path.join(os.tmpdir(), `.memorylane-upload-${process.pid}.${Date.now()}.tmp`)

    try {
      await this.storage.backupToFile(tempPath)

      // Strip (drop sensitive columns/tables + VACUUM) and gzip the backup in a
      // worker process — that work is synchronous, CPU-heavy SQLite I/O and
      // would freeze the UI if it ran on the main thread. gzip shrinks the body
      // ~5-10x; the server detects gzip by magic bytes and inflates it, so no
      // Content-Encoding header is needed and older raw uploads still work.
      const gzipped = await this.prepareUpload(tempPath, this.getStripOptions())
      const formData = new FormData()
      formData.append('file', new Blob([gzipped]), 'memorylane.db.gz')

      const base = this.getBackendUrl().replace(/\/?$/, '/')
      const url = new URL('api/device/upload', base)
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.getDeviceId()}` },
        body: formData,
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`Upload failed (${response.status}): ${body}`)
      }

      const data = (await response.json()) as {
        ok: boolean
        upload_id: string
        checksum_sha256: string
      }
      this.recordUploadAt(Date.now())
      log.info(
        `[DatabaseUploadSync] Upload succeeded (${reason}): upload_id=${data.upload_id} checksum=${data.checksum_sha256}`,
      )
    } finally {
      try {
        fs.rmSync(tempPath, { force: true })
      } catch {
        // best-effort cleanup
      }
    }
  }
}
