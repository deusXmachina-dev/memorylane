import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { normalizeBackendUrl } from '../access/activation-code'
import log from '../logger'

interface PersistedShape {
  backendUrl?: string | null
}

export class EnterpriseLicenseConfig {
  private readonly configPath: string
  private backendUrl: string | null = null
  private loaded = false

  constructor() {
    this.configPath = path.join(app.getPath('userData'), 'enterprise-license.json')
  }

  public load(): void {
    if (this.loaded) return
    this.loaded = true

    if (!fs.existsSync(this.configPath)) return

    try {
      const data = fs.readFileSync(this.configPath, 'utf-8')
      const parsed = JSON.parse(data) as PersistedShape
      if (typeof parsed.backendUrl === 'string' && parsed.backendUrl !== '') {
        const normalized = normalizeBackendUrl(parsed.backendUrl)
        if (normalized === null) {
          log.error(
            `[EnterpriseLicenseConfig] Persisted backend URL failed validation; ignoring: ${parsed.backendUrl}`,
          )
        } else {
          this.backendUrl = normalized
          log.info(`[EnterpriseLicenseConfig] Loaded backend URL: ${this.backendUrl}`)
        }
      }
    } catch (error) {
      log.error('[EnterpriseLicenseConfig] Failed to read config:', error)
    }
  }

  public getBackendUrl(): string | null {
    return this.backendUrl
  }

  public setBackendUrl(url: string | null): void {
    this.backendUrl = url
    this.persist()
    log.info(`[EnterpriseLicenseConfig] Backend URL set to ${url ?? '(cleared)'}`)
  }

  private persist(): void {
    const payload: PersistedShape = { backendUrl: this.backendUrl }
    const tmp = `${this.configPath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2))
    fs.renameSync(tmp, this.configPath)
  }
}
