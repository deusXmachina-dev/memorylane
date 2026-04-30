import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import log from '../logger'
import type { ProviderRegistry } from './registry'
import type { ProviderSource } from './provider'

export interface MigrationResult {
  ranMigration: boolean
  seededOpenRouter: boolean
  seededOpenAICompatible: boolean
}

const LEGACY_API_KEY_FILE = 'secure-config.json'
const LEGACY_CUSTOM_ENDPOINT_FILE = 'custom-endpoint.json'

interface LegacyApiKey {
  key: string
  source: ProviderSource
}

interface LegacyCustomEndpoint {
  serverURL: string
  model: string
  apiKey?: string
}

function readLegacyApiKey(userDataPath: string): LegacyApiKey | null {
  const filePath = path.join(userDataPath, LEGACY_API_KEY_FILE)
  if (!fs.existsSync(filePath)) return null
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn('[ProviderRegistry] safeStorage unavailable; skipping legacy api-key read')
    return null
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
      apiKey?: string
      source?: string
    }
    if (!raw.apiKey) return null
    const decrypted = safeStorage.decryptString(Buffer.from(raw.apiKey, 'base64'))
    const source: ProviderSource = raw.source === 'managed' ? 'managed' : 'byok'
    return { key: decrypted, source }
  } catch (err) {
    log.warn('[ProviderRegistry] Failed to read legacy api-key:', err)
    return null
  }
}

function readLegacyCustomEndpoint(userDataPath: string): LegacyCustomEndpoint | null {
  const filePath = path.join(userDataPath, LEGACY_CUSTOM_ENDPOINT_FILE)
  if (!fs.existsSync(filePath)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as {
      serverURL?: string
      model?: string
      encryptedApiKey?: string
    }
    if (!raw.serverURL || !raw.model) return null
    let apiKey: string | undefined
    if (raw.encryptedApiKey && safeStorage.isEncryptionAvailable()) {
      try {
        apiKey = safeStorage.decryptString(Buffer.from(raw.encryptedApiKey, 'base64'))
      } catch (err) {
        log.warn('[ProviderRegistry] Failed to decrypt legacy custom-endpoint key:', err)
      }
    }
    return { serverURL: raw.serverURL, model: raw.model, apiKey }
  } catch (err) {
    log.warn('[ProviderRegistry] Failed to read legacy custom-endpoint:', err)
    return null
  }
}

function deleteLegacyFile(userDataPath: string, name: string): void {
  const filePath = path.join(userDataPath, name)
  if (!fs.existsSync(filePath)) return
  try {
    fs.unlinkSync(filePath)
    log.info(`[ProviderRegistry] Removed legacy file ${name}`)
  } catch (err) {
    log.warn(`[ProviderRegistry] Failed to remove ${name}:`, err)
  }
}

/**
 * Seed the provider registry from legacy on-disk config files (secure-config.json
 * for OpenRouter, custom-endpoint.json for OpenAI-compatible) on first launch.
 * Skipped if providers.json already exists. Legacy files are deleted on success.
 */
export function seedRegistryFromLegacy(input: { registry: ProviderRegistry }): MigrationResult {
  const { registry } = input

  if (registry.fileExists()) {
    return { ranMigration: false, seededOpenRouter: false, seededOpenAICompatible: false }
  }

  const userDataPath = app.getPath('userData')
  const result: MigrationResult = {
    ranMigration: true,
    seededOpenRouter: false,
    seededOpenAICompatible: false,
  }

  const legacyKey = readLegacyApiKey(userDataPath)
  if (legacyKey) {
    try {
      registry.add({
        kind: 'openrouter',
        name: legacyKey.source === 'managed' ? 'Managed (subscription)' : 'OpenRouter',
        apiKey: legacyKey.key,
        source: legacyKey.source,
      })
      result.seededOpenRouter = true
      log.info('[ProviderRegistry] Seeded OpenRouter provider from legacy config')
    } catch (err) {
      log.warn('[ProviderRegistry] Failed to seed OpenRouter provider:', err)
    }
  }

  const legacyEndpoint = readLegacyCustomEndpoint(userDataPath)
  if (legacyEndpoint) {
    try {
      registry.add({
        kind: 'openai-compatible',
        name: 'Custom endpoint',
        baseURL: legacyEndpoint.serverURL,
        defaultModel: legacyEndpoint.model,
        apiKey: legacyEndpoint.apiKey ?? '',
      })
      result.seededOpenAICompatible = true
      log.info('[ProviderRegistry] Seeded OpenAI-compatible provider from legacy config')
    } catch (err) {
      log.warn('[ProviderRegistry] Failed to seed custom endpoint provider:', err)
    }
  }

  if (result.seededOpenRouter || result.seededOpenAICompatible) {
    deleteLegacyFile(userDataPath, LEGACY_API_KEY_FILE)
    deleteLegacyFile(userDataPath, LEGACY_CUSTOM_ENDPOINT_FILE)
  }

  return result
}
