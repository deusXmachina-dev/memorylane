import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { v4 as uuidv4 } from 'uuid'
import log from '../logger'
import type {
  ProviderConfig,
  ProviderConfigInput,
  ProviderConfigPatch,
  ProviderKind,
  ProvidersSnapshot,
  ProviderStatus,
} from './provider'
import { PROVIDER_KINDS } from './provider'

interface StoredProvider extends ProviderConfig {
  encryptedApiKey: string
}

interface StoredFile {
  version: 1
  activeProviderId: string | null
  providers: StoredProvider[]
}

const STORE_VERSION = 1
const FILE_NAME = 'providers.json'

export class ProviderRegistry {
  private filePath: string
  private cache: StoredFile | null = null

  constructor(filePath?: string) {
    this.filePath = filePath ?? path.join(app.getPath('userData'), FILE_NAME)
  }

  getSnapshot(): ProvidersSnapshot {
    const file = this.read()
    return {
      providers: file.providers.map((p) => this.toStatus(p)),
      activeProviderId: file.activeProviderId,
    }
  }

  list(): ProviderConfig[] {
    return this.read().providers.map((p) => this.toConfig(p))
  }

  get(id: string): ProviderConfig | null {
    const stored = this.read().providers.find((p) => p.id === id)
    return stored ? this.toConfig(stored) : null
  }

  getActive(): ProviderConfig | null {
    const file = this.read()
    if (!file.activeProviderId) return null
    const stored = file.providers.find((p) => p.id === file.activeProviderId)
    return stored ? this.toConfig(stored) : null
  }

  getApiKey(id: string): string | null {
    const stored = this.read().providers.find((p) => p.id === id)
    if (!stored) return null
    return this.decrypt(stored.encryptedApiKey)
  }

  add(input: ProviderConfigInput): ProviderConfig {
    this.assertKind(input.kind)
    if (!input.name.trim()) {
      throw new Error('Provider name is required')
    }
    if (input.kind === 'openai-compatible' && !input.baseURL?.trim()) {
      throw new Error('baseURL is required for openai-compatible providers')
    }

    const file = this.read()
    const id = uuidv4()
    const stored: StoredProvider = {
      id,
      kind: input.kind,
      name: input.name.trim(),
      baseURL: input.baseURL?.trim() || undefined,
      defaultModel: input.defaultModel?.trim() || undefined,
      source: input.source ?? 'byok',
      createdAt: Date.now(),
      encryptedApiKey: this.encrypt(input.apiKey),
    }
    file.providers.push(stored)
    if (!file.activeProviderId) {
      file.activeProviderId = id
    }
    this.write(file)
    log.info(`[ProviderRegistry] Added provider ${id} (${input.kind}: ${input.name})`)
    return this.toConfig(stored)
  }

  update(id: string, patch: ProviderConfigPatch): ProviderConfig {
    const file = this.read()
    const idx = file.providers.findIndex((p) => p.id === id)
    if (idx === -1) {
      throw new Error(`Provider not found: ${id}`)
    }
    const current = file.providers[idx]
    const next: StoredProvider = { ...current }
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim()
      if (!trimmed) throw new Error('Provider name cannot be empty')
      next.name = trimmed
    }
    if (patch.apiKey !== undefined && patch.apiKey.length > 0) {
      next.encryptedApiKey = this.encrypt(patch.apiKey)
    }
    if (patch.baseURL !== undefined) {
      next.baseURL = patch.baseURL?.trim() || undefined
      if (next.kind === 'openai-compatible' && !next.baseURL) {
        throw new Error('baseURL is required for openai-compatible providers')
      }
    }
    if (patch.defaultModel !== undefined) {
      next.defaultModel = patch.defaultModel?.trim() || undefined
    }
    if (patch.source !== undefined) {
      next.source = patch.source
    }
    file.providers[idx] = next
    this.write(file)
    log.info(`[ProviderRegistry] Updated provider ${id}`)
    return this.toConfig(next)
  }

  remove(id: string): void {
    const file = this.read()
    const before = file.providers.length
    file.providers = file.providers.filter((p) => p.id !== id)
    if (file.providers.length === before) return
    if (file.activeProviderId === id) {
      file.activeProviderId = file.providers[0]?.id ?? null
    }
    this.write(file)
    log.info(`[ProviderRegistry] Removed provider ${id}`)
  }

  setActive(id: string | null): void {
    const file = this.read()
    if (id !== null && !file.providers.some((p) => p.id === id)) {
      throw new Error(`Provider not found: ${id}`)
    }
    file.activeProviderId = id
    this.write(file)
    log.info(`[ProviderRegistry] Active provider set to ${id ?? 'none'}`)
  }

  hasAny(): boolean {
    return this.read().providers.length > 0
  }

  fileExists(): boolean {
    return fs.existsSync(this.filePath)
  }

  private toConfig(stored: StoredProvider): ProviderConfig {
    return {
      id: stored.id,
      kind: stored.kind,
      name: stored.name,
      baseURL: stored.baseURL,
      defaultModel: stored.defaultModel,
      source: stored.source ?? 'byok',
      createdAt: stored.createdAt,
    }
  }

  private toStatus(stored: StoredProvider): ProviderStatus {
    const key = this.tryDecrypt(stored.encryptedApiKey)
    return {
      id: stored.id,
      kind: stored.kind,
      name: stored.name,
      baseURL: stored.baseURL ?? null,
      defaultModel: stored.defaultModel ?? null,
      hasApiKey: key !== null && key.length > 0,
      maskedApiKey: key ? maskKey(key) : null,
      source: stored.source ?? 'byok',
      createdAt: stored.createdAt,
    }
  }

  private read(): StoredFile {
    if (this.cache) return this.cache
    if (!fs.existsSync(this.filePath)) {
      this.cache = { version: STORE_VERSION, activeProviderId: null, providers: [] }
      return this.cache
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as StoredFile
      if (parsed.version !== STORE_VERSION) {
        log.warn(`[ProviderRegistry] Unknown version ${parsed.version}; treating as empty`)
        this.cache = { version: STORE_VERSION, activeProviderId: null, providers: [] }
        return this.cache
      }
      this.cache = {
        version: STORE_VERSION,
        activeProviderId: parsed.activeProviderId ?? null,
        providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      }
      return this.cache
    } catch (err) {
      log.error('[ProviderRegistry] Failed to read providers.json:', err)
      this.cache = { version: STORE_VERSION, activeProviderId: null, providers: [] }
      return this.cache
    }
  }

  private write(file: StoredFile): void {
    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2))
    this.cache = file
  }

  private encrypt(plaintext: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this system')
    }
    return safeStorage.encryptString(plaintext).toString('base64')
  }

  private decrypt(encrypted: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Secure storage is not available on this system')
    }
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  }

  private tryDecrypt(encrypted: string): string | null {
    try {
      return this.decrypt(encrypted)
    } catch {
      return null
    }
  }

  private assertKind(kind: ProviderKind): void {
    if (!PROVIDER_KINDS.includes(kind)) {
      throw new Error(`Unknown provider kind: ${kind}`)
    }
  }
}

function maskKey(key: string): string {
  if (key.length <= 12) return '****'
  return `${key.substring(0, 7)}...${key.substring(key.length - 4)}`
}
