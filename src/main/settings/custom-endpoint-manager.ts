import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import log from '../logger'
import type { CustomEndpointConfig, CustomEndpointStatus } from '../../shared/types'

interface StoredConfig {
  serverURL: string
  model: string
  encryptedApiKey?: string // base64-encoded encrypted key
}

export class CustomEndpointManager {
  private configPath: string
  private cached: CustomEndpointConfig | null = null

  constructor() {
    this.configPath = path.join(app.getPath('userData'), 'custom-endpoint.json')
  }

  /**
   * Save custom endpoint configuration.
   * The optional API key is encrypted via safeStorage; serverURL and model are plaintext.
   */
  public saveEndpoint(config: CustomEndpointConfig): void {
    const stored: StoredConfig = {
      serverURL: config.serverURL,
      model: config.model,
    }

    if (config.apiKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Secure storage is not available on this system')
      }
      const encrypted = safeStorage.encryptString(config.apiKey)
      stored.encryptedApiKey = encrypted.toString('base64')
    }

    fs.writeFileSync(this.configPath, JSON.stringify(stored, null, 2))
    this.cached = { ...config }
    log.info('[CustomEndpointManager] Endpoint saved')
  }

  /**
   * Get the stored custom endpoint configuration, or null if none exists.
   */
  public getEndpoint(): CustomEndpointConfig | null {
    if (this.cached) {
      return { ...this.cached }
    }

    if (!fs.existsSync(this.configPath)) {
      return null
    }

    try {
      const data = fs.readFileSync(this.configPath, 'utf-8')
      const stored: StoredConfig = JSON.parse(data)

      const config: CustomEndpointConfig = {
        serverURL: stored.serverURL,
        model: stored.model,
      }

      if (stored.encryptedApiKey) {
        if (!safeStorage.isEncryptionAvailable()) {
          log.warn('[CustomEndpointManager] Secure storage not available, cannot decrypt API key')
        } else {
          const buf = Buffer.from(stored.encryptedApiKey, 'base64')
          config.apiKey = safeStorage.decryptString(buf)
        }
      }

      this.cached = config
      return { ...config }
    } catch (error) {
      log.error('[CustomEndpointManager] Error reading config:', error)
      return null
    }
  }

  /**
   * Delete the stored custom endpoint configuration.
   */
  public deleteEndpoint(): void {
    if (fs.existsSync(this.configPath)) {
      fs.unlinkSync(this.configPath)
      log.info('[CustomEndpointManager] Endpoint deleted')
    }
    this.cached = null
  }

  /**
   * Get current endpoint status for UI display.
   */
  public getStatus(): CustomEndpointStatus {
    const config = this.getEndpoint()
    if (!config) {
      return { enabled: false, serverURL: null, model: null, hasApiKey: false }
    }
    return {
      enabled: true,
      serverURL: config.serverURL,
      model: config.model,
      hasApiKey: !!config.apiKey,
    }
  }
}
