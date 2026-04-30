import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VendorCredentialsManager } from './vendor-credentials-manager'

vi.mock('../logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function makeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8'),
  }
}

describe('VendorCredentialsManager', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function paths() {
    return {
      configPath: path.join(tmpDir, 'vendor-credentials.json'),
      legacyApiKeyConfigPath: path.join(tmpDir, 'secure-config.json'),
      legacyCustomEndpointConfigPath: path.join(tmpDir, 'custom-endpoint.json'),
    }
  }

  it('starts with no credentials when no files exist', () => {
    const m = new VendorCredentialsManager({
      ...paths(),
      safeStorage: makeSafeStorage(),
      env: {},
    })
    expect(m.getCredentials('openrouter')).toBeNull()
    expect(m.getCredentials('openai-compatible')).toBeNull()
    expect(m.migration.ran).toBe(false)
  })

  it('saves and round-trips a key per vendor', () => {
    const m = new VendorCredentialsManager({
      ...paths(),
      safeStorage: makeSafeStorage(),
      env: {},
    })
    m.saveCredentials('openrouter', { apiKey: 'sk-or-test' })
    m.saveCredentials('anthropic', { apiKey: 'sk-ant-test', baseURL: 'https://proxy/' })
    expect(m.getCredentials('openrouter')).toEqual({ apiKey: 'sk-or-test' })
    expect(m.getCredentials('anthropic')).toEqual({
      apiKey: 'sk-ant-test',
      baseURL: 'https://proxy/',
    })
  })

  it('per-vendor isolation: deleting one does not affect others', () => {
    const m = new VendorCredentialsManager({
      ...paths(),
      safeStorage: makeSafeStorage(),
      env: {},
    })
    m.saveCredentials('openai', { apiKey: 'sk-openai' })
    m.saveCredentials('google', { apiKey: 'AIza-google' })
    m.deleteCredentials('openai')
    expect(m.getCredentials('openai')).toBeNull()
    expect(m.getCredentials('google')).toEqual({ apiKey: 'AIza-google' })
  })

  it('falls back to env vars per vendor when no stored key', () => {
    const m = new VendorCredentialsManager({
      ...paths(),
      safeStorage: makeSafeStorage(),
      env: {
        OPENROUTER_API_KEY: 'env-or',
        ANTHROPIC_API_KEY: 'env-ant',
      },
    })
    expect(m.getCredentials('openrouter')).toEqual({ apiKey: 'env-or' })
    expect(m.getCredentials('anthropic')).toEqual({ apiKey: 'env-ant' })
    expect(m.getCredentials('openai')).toBeNull()
    expect(m.getStatus('openrouter').source).toBe('env')
  })

  it('openai-compatible requires both apiKey and baseURL', () => {
    const m = new VendorCredentialsManager({
      ...paths(),
      safeStorage: makeSafeStorage(),
      env: {},
    })
    m.saveCredentials('openai-compatible', { apiKey: 'just-a-key' })
    expect(m.getCredentials('openai-compatible')).toBeNull()
    m.saveCredentials('openai-compatible', { apiKey: 'k', baseURL: 'http://localhost:11434/v1' })
    expect(m.getCredentials('openai-compatible')).toEqual({
      apiKey: 'k',
      baseURL: 'http://localhost:11434/v1',
    })
  })

  it('openai-compatible reports hasKey=true when only baseURL is set (Ollama case)', () => {
    const p = paths()
    fs.writeFileSync(
      p.configPath,
      JSON.stringify({
        version: 2,
        vendors: {
          'openai-compatible': {
            baseURL: 'http://localhost:11434/v1',
            source: 'byok',
          },
        },
      }),
    )
    const m = new VendorCredentialsManager({
      ...p,
      safeStorage: makeSafeStorage(),
      env: {},
    })
    const status = m.getStatus('openai-compatible')
    expect(status.hasKey).toBe(true)
    expect(status.maskedKey).toBeNull()
    expect(status.baseURL).toBe('http://localhost:11434/v1')
    expect(status.source).toBe('stored')
    // Other vendors with no creds remain hasKey=false.
    expect(m.getStatus('openrouter').hasKey).toBe(false)
  })

  it('migrates legacy secure-config.json to v2 openrouter slot', () => {
    const p = paths()
    // Production encodes safeStorage.encryptString(plain).toString('base64').
    // With our shim (encrypt = utf-8 bytes), that becomes base64 of plain bytes.
    const stored = Buffer.from('legacy-or-key', 'utf-8').toString('base64')
    fs.writeFileSync(
      p.legacyApiKeyConfigPath,
      JSON.stringify({ apiKey: stored, source: 'managed' }),
    )
    const m = new VendorCredentialsManager({
      ...p,
      safeStorage: makeSafeStorage(),
      env: {},
    })
    expect(m.migration.ran).toBe(true)
    expect(m.migration.hadCustomEndpoint).toBe(false)
    expect(m.getCredentials('openrouter')).toEqual({ apiKey: 'legacy-or-key' })
    expect(m.getStatus('openrouter').source).toBe('managed')
    expect(fs.existsSync(p.configPath)).toBe(true)
  })

  it('migrates legacy custom-endpoint.json to v2 openai-compatible slot', () => {
    const p = paths()
    const stored = Buffer.from('legacy-ep-key', 'utf-8').toString('base64')
    fs.writeFileSync(
      p.legacyCustomEndpointConfigPath,
      JSON.stringify({
        serverURL: 'http://localhost:11434/v1',
        model: 'llama3:8b',
        encryptedApiKey: stored,
      }),
    )
    const m = new VendorCredentialsManager({
      ...p,
      safeStorage: makeSafeStorage(),
      env: {},
    })
    expect(m.migration.ran).toBe(true)
    expect(m.migration.hadCustomEndpoint).toBe(true)
    expect(m.migration.customEndpointModel).toBe('llama3:8b')
    expect(m.getCredentials('openai-compatible')).toEqual({
      apiKey: 'legacy-ep-key',
      baseURL: 'http://localhost:11434/v1',
    })
  })

  it('legacy custom-endpoint without model leaves customEndpointModel undefined', () => {
    const p = paths()
    fs.writeFileSync(
      p.legacyCustomEndpointConfigPath,
      JSON.stringify({ serverURL: 'http://localhost:11434/v1' }),
    )
    const m = new VendorCredentialsManager({
      ...p,
      safeStorage: makeSafeStorage(),
      env: {},
    })
    expect(m.migration.hadCustomEndpoint).toBe(true)
    expect(m.migration.customEndpointModel).toBeUndefined()
  })

  it('does not re-migrate when v2 file is already present', () => {
    const p = paths()
    fs.writeFileSync(
      p.legacyApiKeyConfigPath,
      JSON.stringify({ apiKey: 'should-be-ignored', source: 'byok' }),
    )
    fs.writeFileSync(
      p.configPath,
      JSON.stringify({
        version: 2,
        vendors: {
          openrouter: {
            apiKey: Buffer.from('already-here', 'utf-8').toString('base64'),
            source: 'byok',
          },
        },
      }),
    )
    const m = new VendorCredentialsManager({
      ...p,
      safeStorage: makeSafeStorage(),
      env: {},
    })
    expect(m.migration.ran).toBe(false)
    // The v2 entry should win — and our shim uses base64 round-trip for "encryption"
    expect(m.getCredentials('openrouter')).toEqual({ apiKey: 'already-here' })
  })

  it('getAllStatuses returns one entry per vendor', () => {
    const m = new VendorCredentialsManager({
      ...paths(),
      safeStorage: makeSafeStorage(),
      env: {},
    })
    m.saveCredentials('openrouter', { apiKey: 'sk-or-x' })
    const all = m.getAllStatuses()
    expect(Object.keys(all).sort()).toEqual([
      'anthropic',
      'google',
      'openai',
      'openai-compatible',
      'openrouter',
    ])
    expect(all.openrouter.hasKey).toBe(true)
    expect(all.openai.hasKey).toBe(false)
  })
})
