import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import { app, safeStorage } from 'electron'

vi.mock('fs')
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData'),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(true),
    encryptString: vi.fn().mockImplementation((str: string) => Buffer.from(`enc:${str}`)),
    decryptString: vi.fn().mockImplementation((buf: Buffer) => buf.toString().replace('enc:', '')),
  },
}))

import { CustomEndpointManager } from './custom-endpoint-manager'

describe('CustomEndpointManager', () => {
  let manager: CustomEndpointManager

  beforeEach(() => {
    vi.resetAllMocks()
    // Re-mock defaults after reset
    vi.mocked(app.getPath).mockReturnValue('/mock/userData')
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
    vi.mocked(safeStorage.encryptString).mockImplementation(
      (str: string) => Buffer.from(`enc:${str}`) as unknown as Buffer,
    )
    vi.mocked(safeStorage.decryptString).mockImplementation((buf: Buffer) =>
      buf.toString().replace('enc:', ''),
    )

    manager = new CustomEndpointManager()
  })

  it('should save and retrieve config with encrypted API key', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)

    let writtenData = ''
    vi.mocked(fs.writeFileSync).mockImplementation((_path, data) => {
      writtenData = data as string
    })
    vi.mocked(fs.readFileSync).mockImplementation(() => writtenData)

    manager.saveEndpoint({
      serverURL: 'http://localhost:11434/v1',
      model: 'llama3.2-vision',
      apiKey: 'my-secret-key',
    })

    // Clear cache to force file read
    manager = new CustomEndpointManager()

    const config = manager.getEndpoint()
    expect(config).not.toBeNull()
    expect(config!.serverURL).toBe('http://localhost:11434/v1')
    expect(config!.model).toBe('llama3.2-vision')
    expect(config!.apiKey).toBe('my-secret-key')
  })

  it('should save and retrieve config without API key', () => {
    let writtenData = ''
    vi.mocked(fs.writeFileSync).mockImplementation((_path, data) => {
      writtenData = data as string
    })
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockImplementation(() => writtenData)

    manager.saveEndpoint({
      serverURL: 'http://localhost:11434/v1',
      model: 'llama3.2-vision',
    })

    manager = new CustomEndpointManager()
    const config = manager.getEndpoint()
    expect(config).not.toBeNull()
    expect(config!.serverURL).toBe('http://localhost:11434/v1')
    expect(config!.model).toBe('llama3.2-vision')
    expect(config!.apiKey).toBeUndefined()
  })

  it('should return null when no config exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const config = manager.getEndpoint()
    expect(config).toBeNull()
  })

  it('should delete config and clear cache', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.writeFileSync).mockImplementation(() => {})

    manager.saveEndpoint({
      serverURL: 'http://localhost:11434/v1',
      model: 'test-model',
    })

    // Confirm it's cached
    expect(manager.getEndpoint()).not.toBeNull()

    manager.deleteEndpoint()

    // After delete, existsSync returns false
    vi.mocked(fs.existsSync).mockReturnValue(false)
    expect(manager.getEndpoint()).toBeNull()
    expect(fs.unlinkSync).toHaveBeenCalled()
  })

  it('should return correct status when enabled', () => {
    vi.mocked(fs.writeFileSync).mockImplementation(() => {})

    manager.saveEndpoint({
      serverURL: 'http://localhost:11434/v1',
      model: 'test-model',
      apiKey: 'key123',
    })

    const status = manager.getStatus()
    expect(status.enabled).toBe(true)
    expect(status.serverURL).toBe('http://localhost:11434/v1')
    expect(status.model).toBe('test-model')
    expect(status.hasApiKey).toBe(true)
  })

  it('should return correct status when disabled', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const status = manager.getStatus()
    expect(status.enabled).toBe(false)
    expect(status.serverURL).toBeNull()
    expect(status.model).toBeNull()
    expect(status.hasApiKey).toBe(false)
  })
})
