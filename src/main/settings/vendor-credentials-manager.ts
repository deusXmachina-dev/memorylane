import * as fs from 'fs'
import * as path from 'path'
import log from '../logger'
import type { Vendor, VendorCredentials, VendorStatus } from '../../shared/types'
import { VENDORS } from '../../shared/types'

interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

interface StoredVendorEntry {
  apiKey?: string
  baseURL?: string
  source?: 'byok' | 'managed'
}

interface StoredV2 {
  version: 2
  vendors: Partial<Record<Vendor, StoredVendorEntry>>
}

const ENV_VARS: Record<Vendor, { apiKey: string; baseURL?: string }> = {
  openrouter: { apiKey: 'OPENROUTER_API_KEY' },
  openai: { apiKey: 'OPENAI_API_KEY', baseURL: 'OPENAI_BASE_URL' },
  anthropic: { apiKey: 'ANTHROPIC_API_KEY', baseURL: 'ANTHROPIC_BASE_URL' },
  google: { apiKey: 'GOOGLE_GENERATIVE_AI_API_KEY' },
  'openai-compatible': {
    apiKey: 'OPENAI_COMPATIBLE_API_KEY',
    baseURL: 'OPENAI_COMPATIBLE_BASE_URL',
  },
}

export interface VendorCredentialsManagerOptions {
  /** Override the v2 file location (test seam). */
  configPath?: string
  /** Override the legacy api-key-manager file location. */
  legacyApiKeyConfigPath?: string
  /** Override the legacy custom-endpoint-manager file location. */
  legacyCustomEndpointConfigPath?: string
  /** Inject a safeStorage shim (for tests). When omitted, uses Electron's. */
  safeStorage?: SafeStorageLike
  /** Inject a process.env for tests. */
  env?: NodeJS.ProcessEnv
}

export interface MigrationResult {
  /** True when a v1 → v2 migration ran during construction. */
  ran: boolean
  /** True if a legacy custom-endpoint config was found and migrated. */
  hadCustomEndpoint: boolean
}

export class VendorCredentialsManager {
  private readonly configPath: string
  private readonly legacyApiKeyConfigPath: string
  private readonly legacyCustomEndpointConfigPath: string
  private readonly safeStorage: SafeStorageLike
  private readonly env: NodeJS.ProcessEnv
  private store: StoredV2
  private readonly cachedKeys: Partial<Record<Vendor, string | null>> = {}
  public readonly migration: MigrationResult

  constructor(options: VendorCredentialsManagerOptions = {}) {
    if (options.safeStorage) {
      this.safeStorage = options.safeStorage
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require('electron') as typeof import('electron')
      this.safeStorage = electron.safeStorage
    }

    const userDataPath = options.configPath
      ? path.dirname(options.configPath)
      : (() => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const electron = require('electron') as typeof import('electron')
          return electron.app.getPath('userData')
        })()

    this.configPath = options.configPath ?? path.join(userDataPath, 'vendor-credentials.json')
    this.legacyApiKeyConfigPath =
      options.legacyApiKeyConfigPath ?? path.join(userDataPath, 'secure-config.json')
    this.legacyCustomEndpointConfigPath =
      options.legacyCustomEndpointConfigPath ?? path.join(userDataPath, 'custom-endpoint.json')
    this.env = options.env ?? process.env

    const loaded = this.load()
    this.store = loaded.store
    this.migration = loaded.migration
  }

  // ---------- public API ----------

  public getCredentials(vendor: Vendor): VendorCredentials | null {
    const key = this.resolveApiKey(vendor)
    const entry = this.store.vendors[vendor]
    const baseURL = entry?.baseURL ?? this.envBaseURL(vendor)
    if (!key && !baseURL) return null
    if (vendor === 'openai-compatible' && (!key || !baseURL)) return null
    if (!key) return null
    const out: VendorCredentials = { apiKey: key }
    if (baseURL) out.baseURL = baseURL
    return out
  }

  public saveCredentials(vendor: Vendor, creds: VendorCredentials): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this system')
    }
    const encrypted = this.safeStorage.encryptString(creds.apiKey).toString('base64')
    const existing = this.store.vendors[vendor] ?? {}
    const next: StoredVendorEntry = {
      ...existing,
      apiKey: encrypted,
    }
    if (creds.baseURL !== undefined) {
      if (creds.baseURL.length === 0) delete next.baseURL
      else next.baseURL = creds.baseURL
    }
    // Saving a key always implies user-provided ('byok'), unless caller is
    // calling saveManagedKey (separate path below).
    next.source = 'byok'
    this.store.vendors[vendor] = next
    this.cachedKeys[vendor] = creds.apiKey
    this.persist()
    log.info(`[VendorCredentialsManager] saved credentials for ${vendor}`)
  }

  public saveManagedKey(vendor: Vendor, apiKey: string): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this system')
    }
    const encrypted = this.safeStorage.encryptString(apiKey).toString('base64')
    const existing = this.store.vendors[vendor] ?? {}
    this.store.vendors[vendor] = {
      ...existing,
      apiKey: encrypted,
      source: 'managed',
    }
    this.cachedKeys[vendor] = apiKey
    this.persist()
    log.info(`[VendorCredentialsManager] saved managed key for ${vendor}`)
  }

  public deleteCredentials(vendor: Vendor): void {
    if (this.store.vendors[vendor]) {
      delete this.store.vendors[vendor]
      this.cachedKeys[vendor] = null
      this.persist()
      log.info(`[VendorCredentialsManager] deleted credentials for ${vendor}`)
    }
  }

  public getStatus(vendor: Vendor): VendorStatus {
    const stored = this.resolveStoredKey(vendor)
    const envKey = this.envApiKey(vendor)
    const key = stored ?? envKey ?? null
    const entry = this.store.vendors[vendor]
    const baseURL = entry?.baseURL ?? this.envBaseURL(vendor) ?? null
    let source: VendorStatus['source']
    if (stored) {
      source = entry?.source === 'managed' ? 'managed' : 'stored'
    } else if (envKey) {
      source = 'env'
    } else {
      source = 'none'
    }
    return {
      hasKey: key !== null,
      source,
      maskedKey: key ? maskKey(key) : null,
      baseURL,
    }
  }

  public getAllStatuses(): Record<Vendor, VendorStatus> {
    const out = {} as Record<Vendor, VendorStatus>
    for (const v of VENDORS) {
      out[v] = this.getStatus(v)
    }
    return out
  }

  // ---------- internals ----------

  private resolveApiKey(vendor: Vendor): string | null {
    const stored = this.resolveStoredKey(vendor)
    if (stored) return stored
    return this.envApiKey(vendor)
  }

  private resolveStoredKey(vendor: Vendor): string | null {
    if (this.cachedKeys[vendor] !== undefined) {
      return this.cachedKeys[vendor] ?? null
    }
    const entry = this.store.vendors[vendor]
    if (!entry?.apiKey) {
      this.cachedKeys[vendor] = null
      return null
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      log.warn(`[VendorCredentialsManager] safeStorage unavailable, cannot decrypt ${vendor}`)
      this.cachedKeys[vendor] = null
      return null
    }
    try {
      const buf = Buffer.from(entry.apiKey, 'base64')
      const plain = this.safeStorage.decryptString(buf)
      this.cachedKeys[vendor] = plain
      return plain
    } catch (error) {
      log.error(`[VendorCredentialsManager] failed to decrypt ${vendor} key:`, error)
      this.cachedKeys[vendor] = null
      return null
    }
  }

  private envApiKey(vendor: Vendor): string | null {
    const envName = ENV_VARS[vendor].apiKey
    const value = this.env[envName]
    return value && value.length > 0 ? value : null
  }

  private envBaseURL(vendor: Vendor): string | undefined {
    const envName = ENV_VARS[vendor].baseURL
    if (!envName) return undefined
    const value = this.env[envName]
    return value && value.length > 0 ? value : undefined
  }

  private persist(): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.store, null, 2))
    } catch (error) {
      log.error('[VendorCredentialsManager] failed to persist:', error)
      throw error
    }
  }

  private load(): { store: StoredV2; migration: MigrationResult } {
    if (fs.existsSync(this.configPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8')) as Partial<StoredV2>
        if (data.version === 2 && data.vendors && typeof data.vendors === 'object') {
          return {
            store: { version: 2, vendors: data.vendors },
            migration: { ran: false, hadCustomEndpoint: false },
          }
        }
      } catch (error) {
        log.error('[VendorCredentialsManager] failed to read v2 config, falling back:', error)
      }
    }
    // Either file is missing or unparseable -> attempt migration from legacy.
    return this.migrateFromLegacy()
  }

  private migrateFromLegacy(): { store: StoredV2; migration: MigrationResult } {
    const store: StoredV2 = { version: 2, vendors: {} }
    let ran = false
    let hadCustomEndpoint = false

    // Legacy api-key-manager config (OpenRouter).
    if (fs.existsSync(this.legacyApiKeyConfigPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.legacyApiKeyConfigPath, 'utf-8')) as {
          apiKey?: string
          source?: 'byok' | 'managed'
        }
        if (raw.apiKey && typeof raw.apiKey === 'string') {
          store.vendors.openrouter = {
            apiKey: raw.apiKey,
            source: raw.source === 'managed' ? 'managed' : 'byok',
          }
          ran = true
          log.info('[VendorCredentialsManager] migrated legacy openrouter key')
        }
      } catch (error) {
        log.warn('[VendorCredentialsManager] failed to read legacy api-key config:', error)
      }
    }

    // Legacy custom-endpoint config (openai-compatible).
    if (fs.existsSync(this.legacyCustomEndpointConfigPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.legacyCustomEndpointConfigPath, 'utf-8')) as {
          serverURL?: string
          encryptedApiKey?: string
        }
        if (raw.serverURL && typeof raw.serverURL === 'string') {
          const entry: StoredVendorEntry = {
            baseURL: raw.serverURL,
            source: 'byok',
          }
          if (raw.encryptedApiKey && typeof raw.encryptedApiKey === 'string') {
            entry.apiKey = raw.encryptedApiKey
          }
          store.vendors['openai-compatible'] = entry
          ran = true
          hadCustomEndpoint = true
          log.info('[VendorCredentialsManager] migrated legacy custom-endpoint config')
        }
      } catch (error) {
        log.warn('[VendorCredentialsManager] failed to read legacy custom-endpoint config:', error)
      }
    }

    if (ran) {
      try {
        fs.writeFileSync(this.configPath, JSON.stringify(store, null, 2))
      } catch (error) {
        log.error('[VendorCredentialsManager] failed to persist migrated config:', error)
      }
    }

    return { store, migration: { ran, hadCustomEndpoint } }
  }
}

function maskKey(key: string): string {
  if (key.length <= 12) return '****'
  return `${key.substring(0, 7)}...${key.substring(key.length - 4)}`
}
