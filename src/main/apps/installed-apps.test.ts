import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Dirent } from 'fs'

vi.mock('fs/promises', () => ({ readdir: vi.fn() }))
vi.mock('child_process', () => ({ execFile: vi.fn() }))
vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

function dirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  } as unknown as Dirent
}

async function setupReaddir(tree: Record<string, Array<[string, boolean]>>): Promise<void> {
  const fsp = await import('fs/promises')
  vi.mocked(fsp.readdir).mockImplementation((async (dir: string) => {
    const entries = tree[dir.replace(/\\/g, '/')]
    if (!entries) return []
    return entries.map(([n, d]) => dirent(n, d))
  }) as unknown as typeof fsp.readdir)
}

async function setupPowershellOutput(lines: string[]): Promise<void> {
  const cp = await import('child_process')
  vi.mocked(cp.execFile).mockImplementation(((...args: unknown[]) => {
    const cb = args[args.length - 1]
    if (typeof cb === 'function') {
      ;(cb as (e: Error | null, out: string, err: string) => void)(null, lines.join('\n'), '')
    }
    return {} as ReturnType<typeof cp.execFile>
  }) as unknown as typeof cp.execFile)
}

async function setupPowershellFailure(): Promise<void> {
  const cp = await import('child_process')
  vi.mocked(cp.execFile).mockImplementation(((...args: unknown[]) => {
    const cb = args[args.length - 1]
    if (typeof cb === 'function') {
      ;(cb as (e: Error | null, out: string, err: string) => void)(
        new Error('powershell crashed'),
        '',
        '',
      )
    }
    return {} as ReturnType<typeof cp.execFile>
  }) as unknown as typeof cp.execFile)
}

describe('listInstalledApps (windows)', () => {
  const ORIGINAL_PLATFORM = Object.getOwnPropertyDescriptor(process, 'platform')!

  beforeEach(() => {
    vi.resetModules()
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    process.env.ProgramData = 'C:/ProgramData'
    process.env.APPDATA = 'C:/AppData'
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', ORIGINAL_PLATFORM)
  })

  it('keeps only shortcuts whose target is an .exe and uses the exe stem as matchToken', async () => {
    const programsA = 'C:/ProgramData/Microsoft/Windows/Start Menu/Programs'
    const programsB = 'C:/AppData/Microsoft/Windows/Start Menu/Programs'
    await setupReaddir({
      [programsA]: [
        ['Google Chrome.lnk', false],
        ['Event Viewer.lnk', false],
        ['Git Release Notes.lnk', false],
        ['Uninstall Node.js.lnk', false],
        ['Subfolder', true],
      ],
      [`${programsA}/Subfolder`]: [['Wordpad.lnk', false]],
      [programsB]: [['Warp.lnk', false]],
    })
    await setupPowershellOutput([
      `${programsA}/Google Chrome.lnk\tC:/Program Files/Google/Chrome/Application/chrome.exe`,
      `${programsA}/Event Viewer.lnk\tC:/Windows/system32/eventvwr.msc`,
      `${programsA}/Git Release Notes.lnk\tC:/Program Files/Git/ReleaseNotes.html`,
      `${programsA}/Subfolder/Wordpad.lnk\tC:/Program Files/Windows NT/Accessories/wordpad.exe`,
      `${programsB}/Warp.lnk\tC:/Users/u/AppData/Local/Warp/Warp.exe`,
    ])

    const { listInstalledApps } = await import('./installed-apps')
    const apps = await listInstalledApps()

    expect(apps).toEqual([
      { displayName: 'Google Chrome', matchToken: 'chrome' },
      { displayName: 'Warp', matchToken: 'warp' },
      { displayName: 'Wordpad', matchToken: 'wordpad' },
    ])
  })

  it('returns empty list when powershell resolver fails', async () => {
    const programs = 'C:/ProgramData/Microsoft/Windows/Start Menu/Programs'
    await setupReaddir({
      [programs]: [['Google Chrome.lnk', false]],
      'C:/AppData/Microsoft/Windows/Start Menu/Programs': [],
    })
    await setupPowershellFailure()

    const { listInstalledApps } = await import('./installed-apps')
    const apps = await listInstalledApps()
    expect(apps).toEqual([])
  })

  it('dedupes multiple shortcuts pointing to the same exe', async () => {
    const programs = 'C:/ProgramData/Microsoft/Windows/Start Menu/Programs'
    await setupReaddir({
      [programs]: [
        ['Python 3.14 (64-bit).lnk', false],
        ['Python 3.14.lnk', false],
      ],
      'C:/AppData/Microsoft/Windows/Start Menu/Programs': [],
    })
    await setupPowershellOutput([
      `${programs}/Python 3.14 (64-bit).lnk\tC:/Python314/python.exe`,
      `${programs}/Python 3.14.lnk\tC:/Python314/python.exe`,
    ])

    const { listInstalledApps } = await import('./installed-apps')
    const apps = await listInstalledApps()
    expect(apps.map((a) => a.matchToken)).toEqual(['python'])
  })
})
