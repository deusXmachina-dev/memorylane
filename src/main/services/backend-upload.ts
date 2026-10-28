import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import log from '@main/utils/logger'
import { BACKEND_UPLOAD_TIMEOUT_MS } from '@/shared/constants'
import type { BackendClient } from './backend-client'
import { PeriodicJob } from './periodic-job'

const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1000
const MAX_PAGES_PER_RUN = 50

function removeQuietly(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true })
  } catch {
    return
  }
}

export function fileForm(bytes: Buffer, filename: string): FormData {
  const form = new FormData()
  form.append('file', new Blob([bytes]), filename)
  return form
}

export interface UploadJob {
  name: string
  endpoint: string
  timeoutMs?: number
  skipReason(): string | null
  produce(tempPath: string): Promise<BodyInit>
  onSuccess(response: Response): Promise<boolean | void>
}

export interface BackendUploadParams {
  job: UploadJob
  backend: BackendClient
  isActivated: () => boolean
  isSyncEnabled?: () => boolean
  intervalMs?: number
}

export class BackendUpload {
  private readonly job: UploadJob
  private readonly backend: BackendClient
  private readonly isActivated: () => boolean
  private readonly isSyncEnabled: () => boolean
  private readonly runner: PeriodicJob

  constructor(params: BackendUploadParams) {
    this.job = params.job
    this.backend = params.backend
    this.isActivated = params.isActivated
    this.isSyncEnabled = params.isSyncEnabled ?? (() => true)
    this.runner = new PeriodicJob({
      name: params.job.name,
      intervalMs: params.intervalMs ?? DEFAULT_CHECK_INTERVAL_MS,
      run: (reason, force) => this.uploadOnce(reason, force),
    })
  }

  start(): void {
    this.runner.start()
  }

  stop(): Promise<void> {
    return this.runner.stop()
  }

  kick(reason: string): void {
    this.runner.kick(reason)
  }

  async triggerUpload(): Promise<{ success: boolean; error?: string }> {
    if (!this.isSyncEnabled()) {
      return { success: false, error: 'Sharing disabled' }
    }
    try {
      await this.runner.run('manual', true)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Upload failed' }
    }
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
      const standDown = await this.backend.standDown()
      if (standDown !== null) {
        log.info(`${tag} Skipping upload (${reason}) — ${standDown}`)
        return
      }
    }

    const startedAt = Date.now()
    const tempPath = path.join(
      os.tmpdir(),
      `.memorylane-${this.job.name}-${process.pid}.${startedAt}.tmp`,
    )

    try {
      for (let page = 1; page <= MAX_PAGES_PER_RUN; page++) {
        try {
          const body = await this.job.produce(tempPath)
          const response = await this.backend.request(this.job.endpoint, {
            method: 'POST',
            body,
            timeoutMs: this.job.timeoutMs ?? BACKEND_UPLOAD_TIMEOUT_MS,
          })

          if (!response.ok) {
            const text = await response.text().catch(() => '')
            throw new Error(`Upload failed (${response.status}): ${text}`)
          }

          const more = await this.job.onSuccess(response)
          log.info(`${tag} Upload succeeded (${reason})`)
          if (more !== true) return
        } finally {
          removeQuietly(tempPath)
        }
      }
      log.warn(`${tag} Stopped after ${MAX_PAGES_PER_RUN} pages (${reason})`)
    } catch (error) {
      if (!force && this.backend.interrupted(startedAt, error)) {
        const message = error instanceof Error ? error.message : String(error)
        log.info(`${tag} Upload deferred (${reason}): ${message}`)
        return
      }
      throw error
    }
  }
}
