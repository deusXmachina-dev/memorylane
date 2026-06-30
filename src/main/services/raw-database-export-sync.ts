import * as fs from 'fs'
import * as path from 'path'
import log from '@main/utils/logger'

const DEFAULT_EXPORT_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface RawDatabaseExportStorage {
  backupToFile(destinationPath: string): Promise<void>
}

export interface RawDatabaseExportSyncParams {
  storage: RawDatabaseExportStorage
  getExportDirectory: () => string
  getInstallationId: () => string
  intervalMs?: number
}

export class RawDatabaseExportSync {
  private readonly storage: RawDatabaseExportStorage
  private readonly getExportDirectory: () => string
  private readonly getInstallationId: () => string
  private readonly intervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null
  private exportRunning = false
  private rerunRequested = false
  private inFlight: Promise<void> = Promise.resolve()

  constructor(params: RawDatabaseExportSyncParams) {
    this.storage = params.storage
    this.getExportDirectory = params.getExportDirectory
    this.getInstallationId = params.getInstallationId
    this.intervalMs = params.intervalMs ?? DEFAULT_EXPORT_INTERVAL_MS
  }

  public start(): void {
    if (this.timer !== null) {
      return
    }

    this.timer = setInterval(() => {
      void this.queueExport('interval')
    }, this.intervalMs)
    this.timer.unref?.()

    void this.queueExport('startup')
  }

  public async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }

    await this.inFlight.catch(() => undefined)
  }

  public onSettingsChanged(): Promise<void> {
    return this.queueExport('settings_changed')
  }

  public getExportFileName(): string {
    return `memorylane-${this.getInstallationId()}.db`
  }

  private async queueExport(reason: string): Promise<void> {
    if (this.exportRunning) {
      this.rerunRequested = true
      return this.inFlight
    }

    this.exportRunning = true
    let nextReason = reason
    this.inFlight = (async () => {
      do {
        this.rerunRequested = false
        await this.exportOnce(nextReason)
        nextReason = 'coalesced'
      } while (this.rerunRequested)
    })()
      .catch((error) => {
        log.error(`[RawDatabaseExportSync] Export failed (${reason}):`, error)
      })
      .finally(() => {
        this.exportRunning = false
      })

    return this.inFlight
  }

  private async exportOnce(reason: string): Promise<void> {
    const exportDirectory = this.getExportDirectory()
    if (!/\S/.test(exportDirectory)) {
      return
    }

    fs.mkdirSync(exportDirectory, { recursive: true })

    const fileName = this.getExportFileName()
    const targetPath = path.join(exportDirectory, fileName)
    const tempPath = path.join(exportDirectory, `.${fileName}.${process.pid}.${Date.now()}.tmp`)

    try {
      await this.storage.backupToFile(tempPath)
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { force: true })
      }
      fs.renameSync(tempPath, targetPath)
      log.info(`[RawDatabaseExportSync] Exported raw database (${reason}) to ${targetPath}`)
    } catch (error) {
      if (fs.existsSync(tempPath)) {
        fs.rmSync(tempPath, { force: true })
      }
      throw error
    }
  }
}
