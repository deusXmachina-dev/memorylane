import { describe, expect, it } from 'vitest'
import { buildAppDataPath, isPackagedElectronExecutable } from './paths'

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

  it('returns the Linux app data directory', () => {
    expect(buildAppDataPath('linux', '/home/example', undefined, false)).toBe(
      '/home/example/.config/MemoryLane',
    )
  })
})
