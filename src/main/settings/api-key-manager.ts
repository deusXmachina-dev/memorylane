import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import log from '../logger'

export type KeySource = 'stored' | 'managed' | 'env' | 'none'

export interface KeyStatus {
  hasKey: boolean
  source: KeySource
  maskedKey: string | null
}

export class ApiKeyManager {
  private configPath: string
  private seedMarkerPath: string
  private cachedKey: string | null = null

  constructor() {
    this.configPath = path.join(app.getPath('userData'), 'secure-config.json')
    this.seedMarkerPath = path.join(app.getPath('userData'), 'api-key-seeded.json')
  }

  /**
   * Save API key using Electron's safeStorage for encryption.
   * Pass source = 'managed' when the key was provisioned via subscription.
   */
  public saveApiKey(key: string, source: 'byok' | 'managed' = 'byok'): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this system')
    }

    const encrypted = safeStorage.encryptString(key)
    const config = { apiKey: encrypted.toString('base64'), source }

    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2))
    this.cachedKey = key

    log.info(`[ApiKeyManager] API key saved securely (source: ${source})`)
  }

  /**
   * Persist a bundled default key once on the first run of this installation.
   * Later user changes are left untouched, including explicit deletion.
   */
  public seedDefaultApiKeyOnFirstRun(key: string): void {
    const normalizedKey = key.trim()
    if (normalizedKey.length === 0) {
      return
    }

    if (fs.existsSync(this.seedMarkerPath)) {
      return
    }

    if (this.hasStoredApiKey()) {
      this.writeSeedMarker()
      return
    }

    this.saveApiKey(normalizedKey)
    this.writeSeedMarker()
    log.info('[ApiKeyManager] Seeded bundled API key on first run')
  }

  /**
   * Get the API key with priority: stored > env > null
   */
  public getApiKey(): string | null {
    // Return cached key if available
    if (this.cachedKey) {
      return this.cachedKey
    }

    // Try stored key first
    const storedKey = this.getStoredKey()
    if (storedKey) {
      this.cachedKey = storedKey
      return storedKey
    }

    // Fallback to environment variable
    const envKey = process.env.OPENROUTER_API_KEY
    if (envKey) {
      return envKey
    }

    return null
  }

  /**
   * Get the stored key from encrypted storage
   */
  private getStoredKey(): string | null {
    if (!fs.existsSync(this.configPath)) {
      return null
    }

    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('[ApiKeyManager] Secure storage not available, cannot decrypt key')
      return null
    }

    try {
      const configData = fs.readFileSync(this.configPath, 'utf-8')
      const config = JSON.parse(configData)

      if (!config.apiKey) {
        return null
      }

      const encryptedBuffer = Buffer.from(config.apiKey, 'base64')
      return safeStorage.decryptString(encryptedBuffer)
    } catch (error) {
      log.error('[ApiKeyManager] Error reading stored key:', error)
      return null
    }
  }

  /**
   * Check if there's a stored key (not env)
   */
  public hasStoredApiKey(): boolean {
    return this.getStoredKey() !== null
  }

  /**
   * Delete the stored API key
   */
  public deleteApiKey(): void {
    if (fs.existsSync(this.configPath)) {
      fs.unlinkSync(this.configPath)
      log.info('[ApiKeyManager] API key deleted')
    }
    this.cachedKey = null
  }

  /**
   * Get the source of the current API key
   */
  public getKeySource(): KeySource {
    if (this.getStoredKey()) {
      return this.getStoredSource() === 'managed' ? 'managed' : 'stored'
    }
    if (process.env.OPENROUTER_API_KEY) {
      return 'env'
    }
    return 'none'
  }

  /**
   * Read the source field from the stored config ('byok' | 'managed')
   */
  private getStoredSource(): string | null {
    try {
      if (!fs.existsSync(this.configPath)) {
        return null
      }
      const configData = fs.readFileSync(this.configPath, 'utf-8')
      const config = JSON.parse(configData)
      return config.source ?? null
    } catch {
      return null
    }
  }

  /**
   * Get current key status for UI display
   */
  public getKeyStatus(): KeyStatus {
    const key = this.getApiKey()
    const source = this.getKeySource()

    return {
      hasKey: key !== null,
      source,
      maskedKey: key ? this.maskKey(key) : null,
    }
  }

  /**
   * Mask API key for display (show first 7 and last 4 characters)
   */
  private maskKey(key: string): string {
    if (key.length <= 12) {
      return '****'
    }
    return `${key.substring(0, 7)}...${key.substring(key.length - 4)}`
  }

  private writeSeedMarker(): void {
    fs.writeFileSync(this.seedMarkerPath, JSON.stringify({ seededAt: new Date().toISOString() }))
  }
}
