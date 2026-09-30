import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import log from '@main/utils/logger'
import { BACKEND_UPLOAD_TIMEOUT_MS } from '@/shared/constants'
import { HostEnvironment, ManualHostEnvironment } from '@main/monitoring/host-environment'

const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1000

function removeQuietly(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true })
  } catch {
    return
  }
}

export interface UploadJob {
  name: string
  endpoint: string
  filename: string
  skipReason(): string | null
  produce(tempPath: string): Promise<Buffer>
  onSuccess(response: Response): Promise<void>
}

export interface BackendUploadParams {
  job: UploadJob
  getDeviceId: () => string
  isActivated: () => boolean
  isSyncEnabled: () => boolean
  getBackendUrl: () => string
  intervalMs?: number
  env?: HostEnvironment
}

export class BackendUpload {
  private readonly job: UploadJob
  private readonly getDeviceId: () => string
  private readonly isActivated: () => boolean
  private readonly isSyncEnabled: () => boolean
  private readonly getBackendUrl: () => string
  private readonly intervalMs: number
  private readonly env: HostEnvironment
  private timer: ReturnType<typeof setInterval> | null = null
  private uploadRunning = false
  private rerunRequested = false
  private rerunForce = false
  private inFlight: Promise<void> = Promise.resolve()

  constructor(params: BackendUploadParams) {
    this.job = params.job
    this.getDeviceId = params.getDeviceId
    this.isActivated = params.isActivated
    this.isSyncEnabled = params.isSyncEnabled
    this.getBackendUrl = params.getBackendUrl
    this.intervalMs = params.intervalMs ?? DEFAULT_CHECK_INTERVAL_MS
    this.env = params.env ?? new ManualHostEnvironment()
  }

  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => this.kick('interval'), this.intervalMs)
    this.timer.unref?.()
    this.kick('startup')
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    await this.inFlight.catch(() => undefined)
  }

  kick(reason: string): void {
    void this.queueUpload(reason, false).catch(() => undefined)
  }

  async triggerUpload(): Promise<{ success: boolean; error?: string }> {
    if (!this.isSyncEnabled()) {
      return { success: false, error: 'Sharing disabled' }
    }
    try {
      await this.queueUpload('manual', true)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Upload failed' }
    }
  }

  private queueUpload(reason: string, force: boolean): Promise<void> {
    if (this.uploadRunning) {
      this.rerunRequested = true
      this.rerunForce ||= force
      return this.inFlight
    }

    this.uploadRunning = true
    let nextReason = reason
    let nextForce = force
    this.inFlight = (async () => {
      do {
        this.rerunRequested = false
        this.rerunForce = false
        await this.uploadOnce(nextReason, nextForce)
        nextReason = 'coalesced'
        nextForce = this.rerunForce
      } while (this.rerunRequested)
    })()
      .catch((error) => {
        log.error(`[${this.job.name}] Upload failed (${reason}):`, error)
        throw error
      })
      .finally(() => {
        this.uploadRunning = false
      })

    return this.inFlight
  }

  private async uploadOnce(reason: string, force: boolean): Promise<void> {
    const tag = `[${this.job.name}]`
    if (!this.isSyncEnabled()) {
      log.debug(`${tag} Skipping upload (${reason}) — sharing disabled`)
      return
    }
    if (!this.isActivated()) {
      if (force) throw new Error('Device not activated')
      log.debug(`${tag} Skipping upload (${reason}) — device not activated`)
      return
    }
    if (!force) {
      const skip = this.job.skipReason()
      if (skip !== null) {
        log.debug(`${tag} Skipping upload (${reason}) — ${skip}`)
        return
      }
      const standDown = await this.env.standDown(this.getBackendUrl())
      if (standDown !== null) {
        log.info(`${tag} Skipping upload (${reason}) — ${standDown}`)
        return
      }
    }

    const startedAt = Date.now()
    const suspend = this.env.suspendSignal()
    const tempPath = path.join(
      os.tmpdir(),
      `.memorylane-${this.job.name}-${process.pid}.${startedAt}.tmp`,
    )

    try {
      const bytes = await this.job.produce(tempPath)
      const formData = new FormData()
      formData.append('file', new Blob([bytes]), this.job.filename)

      const base = this.getBackendUrl().replace(/\/?$/, '/')
      const response = await fetch(new URL(this.job.endpoint, base), {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.getDeviceId()}` },
        body: formData,
        signal: AbortSignal.any([AbortSignal.timeout(BACKEND_UPLOAD_TIMEOUT_MS), suspend.signal]),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`Upload failed (${response.status}): ${body}`)
      }

      await this.job.onSuccess(response)
      log.info(`${tag} Upload succeeded (${reason})`)
    } catch (error) {
      if (!force && this.env.interruptedBy(startedAt, this.getBackendUrl(), error)) {
        const message = error instanceof Error ? error.message : String(error)
        log.info(`${tag} Upload deferred (${reason}): ${message}`)
        return
      }
      throw error
    } finally {
      suspend.release()
      removeQuietly(tempPath)
    }
  }
}
