import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import log from '../logger'
import { stripDatabaseForUpload, type StripOptions } from './strip-database-for-upload'

const DEFAULT_UPLOAD_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface DatabaseUploadStorage {
  backupToFile(destinationPath: string): Promise<void>
}

export interface DatabaseUploadSyncParams {
  storage: DatabaseUploadStorage
  getDeviceId: () => string
  isActivated: () => boolean
  isSyncEnabled: () => boolean
  getStripOptions: () => StripOptions
  backendUrl: string
  intervalMs?: number
}

export class DatabaseUploadSync {
  private readonly storage: DatabaseUploadStorage
  private readonly getDeviceId: () => string
  private readonly isActivated: () => boolean
  private readonly isSyncEnabled: () => boolean
  private readonly getStripOptions: () => StripOptions
  private readonly backendUrl: string
  private readonly intervalMs: number
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
    this.backendUrl = params.backendUrl
    this.intervalMs = params.intervalMs ?? DEFAULT_UPLOAD_INTERVAL_MS
  }

  public start(): void {
    if (this.timer !== null) {
      return
    }

    this.timer = setInterval(() => {
      void this.queueUpload('interval')
    }, this.intervalMs)
    this.timer.unref?.()

    void this.queueUpload('startup')
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
      stripDatabaseForUpload(tempPath, this.getStripOptions())

      const fileBuffer = fs.readFileSync(tempPath)
      const formData = new FormData()
      formData.append('device_id', this.getDeviceId())
      formData.append('file', new Blob([fileBuffer]), 'memorylane.db')

      const base = this.backendUrl.replace(/\/?$/, '/')
      const url = new URL('device/upload', base)
      const response = await fetch(url, { method: 'POST', body: formData })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`Upload failed (${response.status}): ${body}`)
      }

      const data = (await response.json()) as {
        ok: boolean
        upload_id: string
        checksum_sha256: string
      }
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
