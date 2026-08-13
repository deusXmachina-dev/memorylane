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
  loginItem: { openAtLogin: false } as {
    openAtLogin: boolean
    executableWillLaunchAtLogin?: boolean
  },
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged
    },
    getLoginItemSettings: () => mocks.loginItem,
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
    mocks.loginItem = { openAtLogin: false }
    setPlatform('win32')
  })

  afterEach(() => {
    setPlatform(realPlatform)
  })

  it('syncs on first run', () => {
    expect(shouldSyncAutoStartOnStartup(false, true)).toBe(true)
  })

  it('does not sync once initialized and the login item matches the setting', () => {
    mocks.loginItem = { openAtLogin: true }
    expect(shouldSyncAutoStartOnStartup(true, true)).toBe(false)
  })

  it('re-syncs when the login item no longer points at this executable', () => {
    mocks.loginItem = { openAtLogin: false }
    expect(shouldSyncAutoStartOnStartup(true, true)).toBe(true)
  })

  it('leaves an entry the user switched off in Task Manager alone', () => {
    mocks.loginItem = { openAtLogin: true, executableWillLaunchAtLogin: false }
    expect(shouldSyncAutoStartOnStartup(true, true)).toBe(false)
  })

  it('re-syncs when a stale login item outlives a disabled setting', () => {
    mocks.loginItem = { openAtLogin: true }
    expect(shouldSyncAutoStartOnStartup(true, false)).toBe(true)
  })

  it('does not re-sync when autostart is off', () => {
    mocks.loginItem = { openAtLogin: false }
    expect(shouldSyncAutoStartOnStartup(true, false)).toBe(false)
  })

  it('ignores the windows check on macOS', () => {
    setPlatform('darwin')
    mocks.loginItem = { openAtLogin: false }
    expect(shouldSyncAutoStartOnStartup(true, true)).toBe(false)
  })

  it('never syncs in development', () => {
    mocks.isPackaged = false
    expect(shouldSyncAutoStartOnStartup(false, true)).toBe(false)
  })
})
