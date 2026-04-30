import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tempDirs: string[] = []
let mockSafeStorageAvailable = true

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => {
      throw new Error('app.getPath should not be called when constructed with explicit path')
    }),
  },
  safeStorage: {
    isEncryptionAvailable: () => mockSafeStorageAvailable,
    encryptString: (s: string) => Buffer.from(`enc:${s}`, 'utf-8'),
    decryptString: (b: Buffer) => {
      const raw = b.toString('utf-8')
      if (!raw.startsWith('enc:')) throw new Error('not encrypted')
      return raw.slice(4)
    },
  },
}))

vi.mock('../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { ProviderRegistry } from './registry'

function tempPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-test-'))
  tempDirs.push(dir)
  return path.join(dir, 'providers.json')
}

describe('ProviderRegistry', () => {
  beforeEach(() => {
    mockSafeStorageAvailable = true
  })

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('starts empty when the file does not exist', () => {
    const registry = new ProviderRegistry(tempPath())
    expect(registry.getSnapshot()).toEqual({ providers: [], activeProviderId: null })
    expect(registry.hasAny()).toBe(false)
  })

  it('persists added providers and decrypts API keys round-trip', () => {
    const filePath = tempPath()
    const registry = new ProviderRegistry(filePath)
    const config = registry.add({
      kind: 'openrouter',
      name: 'Primary',
      apiKey: 'sk-or-test-1234567890abcdef',
    })

    expect(config.id).toBeDefined()
    expect(config.source).toBe('byok')
    expect(registry.getApiKey(config.id)).toBe('sk-or-test-1234567890abcdef')

    const reread = new ProviderRegistry(filePath)
    expect(reread.getApiKey(config.id)).toBe('sk-or-test-1234567890abcdef')
    expect(reread.getActive()?.id).toBe(config.id)
  })

  it('marks the first added provider as active automatically', () => {
    const registry = new ProviderRegistry(tempPath())
    const first = registry.add({ kind: 'openai', name: 'First', apiKey: 'k1' })
    const second = registry.add({ kind: 'anthropic', name: 'Second', apiKey: 'k2' })
    expect(registry.getActive()?.id).toBe(first.id)
    registry.setActive(second.id)
    expect(registry.getActive()?.id).toBe(second.id)
  })

  it('rejects openai-compatible providers without baseURL', () => {
    const registry = new ProviderRegistry(tempPath())
    expect(() => registry.add({ kind: 'openai-compatible', name: 'Local', apiKey: 'k' })).toThrow(
      /baseURL is required/,
    )
  })

  it('updates apiKey and other fields', () => {
    const registry = new ProviderRegistry(tempPath())
    const config = registry.add({ kind: 'openrouter', name: 'OR', apiKey: 'old-key' })
    registry.update(config.id, { apiKey: 'new-key', defaultModel: 'gpt-4' })
    expect(registry.getApiKey(config.id)).toBe('new-key')
    expect(registry.get(config.id)?.defaultModel).toBe('gpt-4')
  })

  it('removes providers and clears active when removing the active one', () => {
    const registry = new ProviderRegistry(tempPath())
    const first = registry.add({ kind: 'openrouter', name: 'A', apiKey: 'k1' })
    const second = registry.add({ kind: 'anthropic', name: 'B', apiKey: 'k2' })
    expect(registry.getActive()?.id).toBe(first.id)
    registry.remove(first.id)
    expect(registry.getActive()?.id).toBe(second.id)
    registry.remove(second.id)
    expect(registry.getActive()).toBeNull()
  })

  it('preserves managed source through update', () => {
    const registry = new ProviderRegistry(tempPath())
    const config = registry.add({
      kind: 'openrouter',
      name: 'Managed',
      apiKey: 'managed-key',
      source: 'managed',
    })
    expect(config.source).toBe('managed')
    registry.update(config.id, { apiKey: 'rotated-key' })
    expect(registry.get(config.id)?.source).toBe('managed')
  })

  it('exposes a status snapshot with masked keys but no plaintext', () => {
    const registry = new ProviderRegistry(tempPath())
    const config = registry.add({
      kind: 'openrouter',
      name: 'OR',
      apiKey: 'sk-or-1234567890abcdef-secret',
    })
    const snapshot = registry.getSnapshot()
    expect(snapshot.activeProviderId).toBe(config.id)
    expect(snapshot.providers).toHaveLength(1)
    const status = snapshot.providers[0]
    expect(status.hasApiKey).toBe(true)
    expect(status.maskedApiKey).toContain('...')
    expect(JSON.stringify(snapshot)).not.toContain('sk-or-1234567890abcdef-secret')
  })
})
