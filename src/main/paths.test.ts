import { describe, expect, it } from 'vitest'
import { buildAppDataPath, getAppDirectoryName, isPackagedElectronExecutable } from './paths'

describe('isPackagedElectronExecutable', () => {
  it('detects the installed MemoryLane executable as packaged', () => {
    expect(isPackagedElectronExecutable('C:\\Program Files\\MemoryLane\\MemoryLane.exe')).toBe(true)
  })

  it('detects the local Electron dev executable as unpackaged', () => {
    expect(
      isPackagedElectronExecutable('C:\\repo\\node_modules\\electron\\dist\\electron.exe'),
    ).toBe(false)
  })
})

describe('buildAppDataPath', () => {
  it('returns the production Windows app data directory', () => {
    expect(
      buildAppDataPath(
        'win32',
        'C:\\Users\\Example',
        'C:\\Users\\Example\\AppData\\Roaming',
        false,
      ),
    ).toBe('C:\\Users\\Example\\AppData\\Roaming\\MemoryLane')
  })

  it('returns the dev Windows app data directory', () => {
    expect(
      buildAppDataPath('win32', 'C:\\Users\\Example', 'C:\\Users\\Example\\AppData\\Roaming', true),
    ).toBe('C:\\Users\\Example\\AppData\\Roaming\\MemoryLane-dev')
  })

  it('returns the macOS app data directory', () => {
    expect(buildAppDataPath('darwin', '/Users/example', undefined, false)).toBe(
      '/Users/example/Library/Application Support/MemoryLane',
    )
  })

  it('returns the fallback Unix app data directory', () => {
    expect(buildAppDataPath('freebsd', '/home/example', undefined, false)).toBe(
      '/home/example/.config/MemoryLane',
    )
  })

  it('returns the enterprise macOS app data directory', () => {
    expect(buildAppDataPath('darwin', '/Users/example', undefined, false, 'enterprise')).toBe(
      '/Users/example/Library/Application Support/MemoryLane Enterprise',
    )
  })

  it('returns the dev enterprise macOS app data directory', () => {
    expect(buildAppDataPath('darwin', '/Users/example', undefined, true, 'enterprise')).toBe(
      '/Users/example/Library/Application Support/MemoryLane Enterprise-dev',
    )
  })

  it('returns the enterprise Windows app data directory', () => {
    expect(
      buildAppDataPath(
        'win32',
        'C:\\Users\\Example',
        'C:\\Users\\Example\\AppData\\Roaming',
        false,
        'enterprise',
      ),
    ).toBe('C:\\Users\\Example\\AppData\\Roaming\\MemoryLane Enterprise')
  })

  it('returns the dev enterprise Windows app data directory', () => {
    expect(
      buildAppDataPath(
        'win32',
        'C:\\Users\\Example',
        'C:\\Users\\Example\\AppData\\Roaming',
        true,
        'enterprise',
      ),
    ).toBe('C:\\Users\\Example\\AppData\\Roaming\\MemoryLane Enterprise-dev')
  })

  it('returns the enterprise fallback Unix app data directory', () => {
    expect(buildAppDataPath('freebsd', '/home/example', undefined, false, 'enterprise')).toBe(
      '/home/example/.config/MemoryLane Enterprise',
    )
  })
})

describe('getAppDirectoryName', () => {
  it('defaults to customer when edition is omitted (backwards-compat)', () => {
    expect(getAppDirectoryName(false)).toBe('MemoryLane')
    expect(getAppDirectoryName(true)).toBe('MemoryLane-dev')
  })

  it('returns the customer directory name', () => {
    expect(getAppDirectoryName(false, 'customer')).toBe('MemoryLane')
    expect(getAppDirectoryName(true, 'customer')).toBe('MemoryLane-dev')
  })

  it('returns the enterprise directory name', () => {
    expect(getAppDirectoryName(false, 'enterprise')).toBe('MemoryLane Enterprise')
    expect(getAppDirectoryName(true, 'enterprise')).toBe('MemoryLane Enterprise-dev')
  })
})
