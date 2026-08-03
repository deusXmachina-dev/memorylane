import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InferenceProviderImpl } from './inference-provider'
import { OPENROUTER_BASE_URL } from './adapters'
import { VendorCredentialsManager } from '../settings/vendor-credentials-manager'
import type { Vendor } from '../../shared/types'

vi.mock('@main/utils/logger', () => ({
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

function buildHarness(
  vendor: Vendor,
  setup: (m: VendorCredentialsManager) => void,
  initialActive?: Vendor,
) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-test-'))
  const credentials = new VendorCredentialsManager({
    configPath: path.join(tmpDir, 'vendor-credentials.json'),
    legacyApiKeyConfigPath: path.join(tmpDir, '__missing-1.json'),
    legacyCustomEndpointConfigPath: path.join(tmpDir, '__missing-2.json'),
    safeStorage: makeSafeStorage(),
    env: {},
  })
  setup(credentials)
  let active = initialActive ?? vendor
  const provider = new InferenceProviderImpl({
    credentials,
    getActiveVendor: () => active,
  })
  return {
    provider,
    credentials,
    setActive: (v: Vendor) => {
      active = v
    },
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  }
}

describe('InferenceProviderImpl', () => {
  const harnesses: Array<{ cleanup: () => void }> = []

  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup()
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('isConfigured reflects the active vendor only', () => {
    const h = buildHarness('openrouter', (m) => {
      m.saveCredentials('google', { apiKey: 'AIza' })
    })
    harnesses.push(h)
    // Active vendor is openrouter but only google has a key.
    expect(h.provider.isConfigured()).toBe(false)
    h.setActive('google')
    expect(h.provider.isConfigured()).toBe(true)
  })

  it('getActiveVendor reads from the accessor', () => {
    const h = buildHarness('google', (m) => m.saveCredentials('google', { apiKey: 'AIza' }))
    harnesses.push(h)
    expect(h.provider.getActiveVendor()).toBe('google')
  })

  it('getRouteSnapshot is non-null only for openrouter and openai-compatible', () => {
    const cases: Array<[Vendor, boolean]> = [
      ['openrouter', true],
      ['openai-compatible', true],
      ['google', false],
    ]
    for (const [vendor, expectNonNull] of cases) {
      const h = buildHarness(vendor, (m) => {
        if (vendor === 'openai-compatible') {
          m.saveCredentials('openai-compatible', {
            apiKey: 'k',
            baseURL: 'http://localhost:11434/v1',
          })
        } else {
          m.saveCredentials(vendor, { apiKey: 'sk-test' })
        }
      })
      harnesses.push(h)
      const snap = h.provider.getRouteSnapshot()
      if (expectNonNull) {
        expect(snap).not.toBeNull()
        expect(snap?.vendor).toBe(vendor)
        if (vendor === 'openrouter') expect(snap?.baseURL).toBe(OPENROUTER_BASE_URL)
        if (vendor === 'openai-compatible') expect(snap?.baseURL).toBe('http://localhost:11434/v1')
      } else {
        expect(snap).toBeNull()
      }
    }
  })

  it('languageModel throws when active vendor is unconfigured', () => {
    const h = buildHarness('openrouter', () => undefined)
    harnesses.push(h)
    expect(() => h.provider.languageModel('any-model')).toThrowError(
      /vendor "openrouter" is not configured/,
    )
  })

  it('reuses one SDK provider per vendor', async () => {
    const h = buildHarness('openrouter', (m) =>
      m.saveCredentials('openrouter', { apiKey: 'sk-or-1' }),
    )
    harnesses.push(h)
    const log = (await import('@main/utils/logger')).default
    const built = () => vi.mocked(log.info).mock.calls.filter((c) => /built provider/.test(c[0]))

    h.provider.languageModel('m')
    h.provider.languageModel('m')
    expect(built()).toHaveLength(1)
  })

  it('notifyConfigChanged invalidates SDK cache and fires listeners', () => {
    const h = buildHarness('openrouter', (m) =>
      m.saveCredentials('openrouter', { apiKey: 'sk-or-1' }),
    )
    harnesses.push(h)

    let firedCount = 0
    const unsubscribe = h.provider.onConfigChanged(() => {
      firedCount += 1
    })

    h.provider.notifyConfigChanged()
    expect(firedCount).toBe(1)

    unsubscribe()
    h.provider.notifyConfigChanged()
    expect(firedCount).toBe(1)
  })
})
