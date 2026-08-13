import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shouldSyncAutoStartOnStartup } from './auto-start'

vi.mock('@main/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@main/system/edition', () => ({
  loadAppEditionConfig: () => ({ edition: 'customer' }),
}))

const mocks = vi.hoisted(() => ({
  isPackaged: true,
  getLoginItemSettings: vi.fn(() => ({ openAtLogin: false, executableWillLaunchAtLogin: false })),
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged
    },
    getLoginItemSettings: mocks.getLoginItemSettings,
    setLoginItemSettings: vi.fn(),
  },
}))

describe('shouldSyncAutoStartOnStartup', () => {
  const realPlatform = process.platform

  const setPlatform = (platform: NodeJS.Platform): void => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  }

  beforeEach(() => {
    mocks.isPackaged = true
    mocks.getLoginItemSettings.mockClear()
    setPlatform('win32')
  })

  afterEach(() => {
    setPlatform(realPlatform)
  })

  it('syncs on first run', () => {
    expect(shouldSyncAutoStartOnStartup('')).toBe(true)
  })

  it('does not sync once synced for this executable', () => {
    expect(shouldSyncAutoStartOnStartup(process.execPath)).toBe(false)
  })

  it('re-syncs once after the per-machine install is evicted', () => {
    expect(shouldSyncAutoStartOnStartup('C:\\Program Files\\MemoryLane\\MemoryLane.exe')).toBe(true)
  })

  it('leaves an entry the user switched off in Task Manager alone', () => {
    expect(shouldSyncAutoStartOnStartup(process.execPath)).toBe(false)
    expect(mocks.getLoginItemSettings).not.toHaveBeenCalled()
  })

  it('re-syncs on macOS when the app bundle moved', () => {
    setPlatform('darwin')
    expect(shouldSyncAutoStartOnStartup('/Users/someone/Downloads/MemoryLane.app')).toBe(true)
  })

  it('does not re-sync on macOS once synced', () => {
    setPlatform('darwin')
    expect(shouldSyncAutoStartOnStartup(process.execPath)).toBe(false)
  })

  it('never syncs in development', () => {
    mocks.isPackaged = false
    expect(shouldSyncAutoStartOnStartup('')).toBe(false)
  })
})
