import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VendorCredentialsManager, validateVendorBaseURL } from './vendor-credentials-manager'

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
    m.saveCredentials('google', { apiKey: 'AIza-test' })
    expect(m.getCredentials('openrouter')).toEqual({ apiKey: 'sk-or-test' })
    expect(m.getCredentials('google')).toEqual({ apiKey: 'AIza-test' })
  })

  it('per-vendor isolation: deleting one does not affect others', () => {
    const m = new VendorCredentialsManager({
      ...paths(),
      safeStorage: makeSafeStorage(),
      env: {},
    })
    m.saveCredentials('openrouter', { apiKey: 'sk-or-test' })
    m.saveCredentials('google', { apiKey: 'AIza-google' })
    m.deleteCredentials('openrouter')
    expect(m.getCredentials('openrouter')).toBeNull()
    expect(m.getCredentials('google')).toEqual({ apiKey: 'AIza-google' })
  })

  it('falls back to env vars per vendor when no stored key', () => {
    const m = new VendorCredentialsManager({
      ...paths(),
      safeStorage: makeSafeStorage(),
      env: {
        OPENROUTER_API_KEY: 'env-or',
        GOOGLE_VERTEX_API_KEY: 'env-google',
      },
    })
    expect(m.getCredentials('openrouter')).toEqual({ apiKey: 'env-or' })
    expect(m.getCredentials('google')).toEqual({ apiKey: 'env-google' })
    expect(m.getCredentials('openai-compatible')).toBeNull()
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

  it('preserves a corrupt v2 file and does not migrate over it', () => {
    const p = paths()
    const corrupt = '{ this is not valid json'
    fs.writeFileSync(p.configPath, corrupt)
    // A legacy file that *would* be migrated if the v2 file weren't present.
    const stored = Buffer.from('legacy-or-key', 'utf-8').toString('base64')
    fs.writeFileSync(p.legacyApiKeyConfigPath, JSON.stringify({ apiKey: stored, source: 'byok' }))

    const m = new VendorCredentialsManager({
      ...p,
      safeStorage: makeSafeStorage(),
      env: {},
    })

    // Migration must NOT run, otherwise the corrupt file would be clobbered.
    expect(m.migration.ran).toBe(false)
    expect(m.getCredentials('openrouter')).toBeNull()
    // Corrupt file is preserved on disk for manual recovery.
    expect(fs.readFileSync(p.configPath, 'utf-8')).toBe(corrupt)
  })

  it('preserves a v2 file with unexpected shape and does not migrate over it', () => {
    const p = paths()
    fs.writeFileSync(p.configPath, JSON.stringify({ version: 1, foo: 'bar' }))
    const stored = Buffer.from('legacy-or-key', 'utf-8').toString('base64')
    fs.writeFileSync(p.legacyApiKeyConfigPath, JSON.stringify({ apiKey: stored, source: 'byok' }))

    const m = new VendorCredentialsManager({
      ...p,
      safeStorage: makeSafeStorage(),
      env: {},
    })

    expect(m.migration.ran).toBe(false)
    expect(m.getCredentials('openrouter')).toBeNull()
    expect(JSON.parse(fs.readFileSync(p.configPath, 'utf-8'))).toEqual({
      version: 1,
      foo: 'bar',
    })
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

  describe('validateVendorBaseURL', () => {
    it('accepts https URLs to any host', () => {
      expect(validateVendorBaseURL('https://api.openai.com/v1')).toBe('https://api.openai.com/v1')
      expect(validateVendorBaseURL('https://example.com/path')).toBe('https://example.com/path')
    })

    it('accepts http URLs only for loopback hosts', () => {
      expect(validateVendorBaseURL('http://localhost:11434/v1')).toBe('http://localhost:11434/v1')
      expect(validateVendorBaseURL('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434/v1')
    })

    it('returns empty string for empty / whitespace / undefined input', () => {
      expect(validateVendorBaseURL('')).toBe('')
      expect(validateVendorBaseURL('   ')).toBe('')
      expect(validateVendorBaseURL(undefined)).toBe('')
      expect(validateVendorBaseURL(null)).toBe('')
    })

    it('rejects http URLs to non-loopback hosts', () => {
      expect(() => validateVendorBaseURL('http://10.0.0.1/')).toThrow(/localhost/)
      expect(() => validateVendorBaseURL('http://evil.example.com/v1')).toThrow(/localhost/)
    })

    it('rejects file:, ftp:, and other schemes', () => {
      expect(() => validateVendorBaseURL('file:///etc/passwd')).toThrow(/scheme/)
      expect(() => validateVendorBaseURL('ftp://example.com/')).toThrow(/scheme/)
    })

    it('rejects URLs with embedded credentials', () => {
      expect(() => validateVendorBaseURL('https://attacker:pw@evil.example.com/')).toThrow(
        /credentials/,
      )
      expect(() => validateVendorBaseURL('https://user@evil.example.com/')).toThrow(/credentials/)
    })

    it('rejects malformed URLs', () => {
      expect(() => validateVendorBaseURL('not-a-url')).toThrow(/valid URL/)
      expect(() => validateVendorBaseURL('://broken')).toThrow(/valid URL/)
    })

    it('rejects overlong values', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2050)
      expect(() => validateVendorBaseURL(longUrl)).toThrow(/too long/)
    })

    it('rejects non-string values', () => {
      expect(() => validateVendorBaseURL(42 as unknown)).toThrow(/string/)
      expect(() => validateVendorBaseURL({} as unknown)).toThrow(/string/)
    })

    describe('per-vendor domain enforcement', () => {
      it('accepts openrouter baseURLs on openrouter.ai (any subdomain)', () => {
        expect(validateVendorBaseURL('https://openrouter.ai/api/v1', 'openrouter')).toBe(
          'https://openrouter.ai/api/v1',
        )
        expect(validateVendorBaseURL('https://api.openrouter.ai/v1', 'openrouter')).toBe(
          'https://api.openrouter.ai/v1',
        )
      })

      it('rejects openrouter baseURLs on a different domain', () => {
        expect(() => validateVendorBaseURL('https://attacker.example/v1', 'openrouter')).toThrow(
          /openrouter\.ai/,
        )
      })

      it('accepts google baseURLs on googleapis.com', () => {
        expect(
          validateVendorBaseURL('https://generativelanguage.googleapis.com/v1beta', 'google'),
        ).toBe('https://generativelanguage.googleapis.com/v1beta')
      })

      it('rejects google baseURLs on a different domain', () => {
        expect(() => validateVendorBaseURL('https://attacker.example/', 'google')).toThrow(
          /googleapis\.com/,
        )
      })

      it('does not pin a domain for openai-compatible (arbitrary host allowed)', () => {
        expect(validateVendorBaseURL('https://anything.example/v1', 'openai-compatible')).toBe(
          'https://anything.example/v1',
        )
        expect(validateVendorBaseURL('http://localhost:11434/v1', 'openai-compatible')).toBe(
          'http://localhost:11434/v1',
        )
      })
    })
  })

  it('saveCredentials rejects an out-of-domain baseURL for pinned vendors', () => {
    const m = new VendorCredentialsManager({
      ...paths(),
      safeStorage: makeSafeStorage(),
      env: {},
    })
    expect(() =>
      m.saveCredentials('openrouter', {
        apiKey: 'sk-or-x',
        baseURL: 'https://attacker.example/v1',
      }),
    ).toThrow(/openrouter\.ai/)
    expect(m.getCredentials('openrouter')).toBeNull()
  })

  it('saveCredentials rejects an SSRF baseURL before persisting', () => {
    const m = new VendorCredentialsManager({
      ...paths(),
      safeStorage: makeSafeStorage(),
      env: {},
    })
    expect(() =>
      m.saveCredentials('openai-compatible', {
        apiKey: 'sk-x',
        baseURL: 'file:///etc/passwd',
      }),
    ).toThrow(/scheme/)
    expect(() =>
      m.saveCredentials('openai-compatible', {
        apiKey: 'sk-x',
        baseURL: 'http://10.0.0.1/v1',
      }),
    ).toThrow(/localhost/)
    // Nothing should have been persisted.
    expect(m.getCredentials('openai-compatible')).toBeNull()
  })

  it('getAllStatuses returns one entry per vendor', () => {
    const m = new VendorCredentialsManager({
      ...paths(),
      safeStorage: makeSafeStorage(),
      env: {},
    })
    m.saveCredentials('openrouter', { apiKey: 'sk-or-x' })
    const all = m.getAllStatuses()
    expect(Object.keys(all).sort()).toEqual(['google', 'openai-compatible', 'openrouter'])
    expect(all.openrouter.hasKey).toBe(true)
    expect(all.google.hasKey).toBe(false)
  })
})
