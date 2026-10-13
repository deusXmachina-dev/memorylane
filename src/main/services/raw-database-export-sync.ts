import * as fs from 'fs'
import * as path from 'path'
import log from '@main/utils/logger'
import { PeriodicJob } from './periodic-job'

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
  private readonly runner: PeriodicJob

  constructor(params: RawDatabaseExportSyncParams) {
    this.storage = params.storage
    this.getExportDirectory = params.getExportDirectory
    this.getInstallationId = params.getInstallationId
    this.runner = new PeriodicJob({
      name: 'RawDatabaseExportSync',
      intervalMs: params.intervalMs ?? DEFAULT_EXPORT_INTERVAL_MS,
      run: (reason) => this.exportOnce(reason),
    })
  }

  public start(): void {
    this.runner.start()
  }

  public stop(): Promise<void> {
    return this.runner.stop()
  }

  public onSettingsChanged(): Promise<void> {
    return this.runner.run('settings_changed').catch(() => undefined)
  }

  public getExportFileName(): string {
    return `memorylane-${this.getInstallationId()}.db`
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
