import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceIdentity, DeviceIdentityUnavailableError } from './device-identity'

vi.mock('@main/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Mutable, hoisted state so each test can toggle secure-storage behaviour.
const mocks = vi.hoisted(() => ({
  userDataDir: '',
  encryptionAvailable: true,
  failDecrypt: false,
}))

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => mocks.encryptionAvailable,
    encryptString: (s: string) => Buffer.from(s, 'utf-8'),
    decryptString: (b: Buffer) => {
      if (mocks.failDecrypt) throw new Error('decrypt failed')
      return b.toString('utf-8')
    },
  },
}))

describe('DeviceIdentity', () => {
  let configPath: string

  beforeEach(() => {
    mocks.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-id-test-'))
    mocks.encryptionAvailable = true
    mocks.failDecrypt = false
    configPath = path.join(mocks.userDataDir, 'device-identity.json')
  })

  afterEach(() => {
    fs.rmSync(mocks.userDataDir, { recursive: true, force: true })
  })

  it('generates and persists a device ID on first run, then reads it back', () => {
    const first = new DeviceIdentity().getDeviceId()
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(fs.existsSync(configPath)).toBe(true)

    // A fresh instance (no in-memory cache) reads the same persisted id.
    const second = new DeviceIdentity().getDeviceId()
    expect(second).toBe(first)
  })

  it('throws and does NOT overwrite the file when secure storage is unavailable', () => {
    const original = new DeviceIdentity().getDeviceId()
    const fileBefore = fs.readFileSync(configPath, 'utf-8')

    mocks.encryptionAvailable = false
    expect(() => new DeviceIdentity().getDeviceId()).toThrow(DeviceIdentityUnavailableError)

    // The existing identity must be preserved untouched, not regenerated.
    expect(fs.readFileSync(configPath, 'utf-8')).toBe(fileBefore)
    void original
  })

  it('throws and does NOT overwrite the file when decryption fails', () => {
    new DeviceIdentity().getDeviceId()
    const fileBefore = fs.readFileSync(configPath, 'utf-8')

    mocks.failDecrypt = true
    expect(() => new DeviceIdentity().getDeviceId()).toThrow(DeviceIdentityUnavailableError)
    expect(fs.readFileSync(configPath, 'utf-8')).toBe(fileBefore)
  })

  it('regenerates a fresh id when the stored file is malformed JSON', () => {
    fs.writeFileSync(configPath, '{ not valid json')

    // No id was ever recoverable here, so generating is correct (not a throw).
    const id = new DeviceIdentity().getDeviceId()
    expect(id).toMatch(/^[0-9a-f]{64}$/)

    // The garbage was replaced with a real, readable identity.
    expect(new DeviceIdentity().getDeviceId()).toBe(id)
  })

  it('regenerates a fresh id when the stored file is missing the deviceId field', () => {
    fs.writeFileSync(configPath, JSON.stringify({ somethingElse: true }))

    const id = new DeviceIdentity().getDeviceId()
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(new DeviceIdentity().getDeviceId()).toBe(id)
  })

  it('recovers the original id once secure storage comes back', () => {
    const original = new DeviceIdentity().getDeviceId()

    // Transient outage: unreadable, throws.
    mocks.encryptionAvailable = false
    expect(() => new DeviceIdentity().getDeviceId()).toThrow(DeviceIdentityUnavailableError)

    // Storage recovers: the same id loads — proof we never regenerated.
    mocks.encryptionAvailable = true
    expect(new DeviceIdentity().getDeviceId()).toBe(original)
  })

  it('throws rather than caching an ephemeral id when first-run persist fails', () => {
    mocks.encryptionAvailable = false
    expect(() => new DeviceIdentity().getDeviceId()).toThrow(DeviceIdentityUnavailableError)
    // Nothing should have been written.
    expect(fs.existsSync(configPath)).toBe(false)
  })
})
