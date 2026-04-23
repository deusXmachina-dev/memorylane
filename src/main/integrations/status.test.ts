import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

// Redirect HOME so the integrations read test config files, and stub out the
// electron.app paths so isCurrentAppEntry has deterministic inputs.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'memorylane-status-'))
const MOCK_EXE = '/Applications/MemoryLane.app/Contents/MacOS/MemoryLane'
const MOCK_APP_PATH = '/Applications/MemoryLane.app/Contents/Resources/app.asar'
const MOCK_SCRIPT = path.join(MOCK_APP_PATH, 'out', 'main', 'mcp-entry.js')

// Lock Windows env vars under TMP_HOME so we don't read from or write to the
// real user profile, and so MSIX discovery only sees the Claude_* dirs the
// tests set up themselves.
const STUB_APPDATA = path.join(TMP_HOME, 'AppData', 'Roaming')
const STUB_LOCALAPPDATA = path.join(TMP_HOME, 'AppData', 'Local')
vi.stubEnv('APPDATA', STUB_APPDATA)
vi.stubEnv('LOCALAPPDATA', STUB_LOCALAPPDATA)

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key: string) => (key === 'exe' ? MOCK_EXE : TMP_HOME)),
    getAppPath: vi.fn(() => MOCK_APP_PATH),
    isPackaged: true,
  },
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return { ...actual, homedir: vi.fn(() => TMP_HOME) }
})

import { getClaudeDesktopStatus, registerWithClaudeDesktop } from './claude-desktop'
import { getClaudeCodeStatus } from './claude-code'
import { getCursorStatus } from './cursor'

afterAll(() => {
  vi.unstubAllEnvs()
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
})

function claudeDesktopConfigPath(): string {
  switch (process.platform) {
    case 'darwin':
      return path.join(
        TMP_HOME,
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json',
      )
    case 'win32':
      return path.join(STUB_APPDATA, 'Claude', 'claude_desktop_config.json')
    default:
      return path.join(TMP_HOME, '.config', 'Claude', 'claude_desktop_config.json')
  }
}

function msixPackagesDir(): string {
  return path.join(STUB_LOCALAPPDATA, 'Packages')
}

function msixConfigPath(pkg = 'Claude_pzs8sxrjxfjjc'): string {
  return path.join(
    msixPackagesDir(),
    pkg,
    'LocalCache',
    'Roaming',
    'Claude',
    'claude_desktop_config.json',
  )
}

function writeClaudeDesktopConfig(entry: unknown): void {
  const configPath = claudeDesktopConfigPath()
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { memorylane: entry } }, null, 2))
}

function writeMsixConfig(entry: unknown, pkg?: string): void {
  const configPath = msixConfigPath(pkg)
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { memorylane: entry } }, null, 2))
}

function writeClaudeCodeSettings(entry: unknown): void {
  const settingsPath = path.join(TMP_HOME, '.claude', 'settings.json')
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(settingsPath, JSON.stringify({ mcpServers: { memorylane: entry } }, null, 2))
}

function writeCursorConfig(entry: unknown): void {
  const configPath = path.join(TMP_HOME, '.cursor', 'mcp.json')
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { memorylane: entry } }, null, 2))
}

function clearClaudeDesktopConfig(): void {
  fs.rmSync(claudeDesktopConfigPath(), { force: true })
  fs.rmSync(msixPackagesDir(), { recursive: true, force: true })
}

const CURRENT_ENTRY = {
  command: MOCK_EXE,
  args: [MOCK_SCRIPT],
  env: { ELECTRON_RUN_AS_NODE: '1' },
}

const STALE_NPX_ENTRY = {
  command: 'npx',
  args: ['-y', '-p', '@deusxmachina-dev/memorylane-cli', 'memorylane-mcp'],
}

const STALE_MOVED_APP_ENTRY = {
  command: '/Applications/MemoryLane-old.app/Contents/MacOS/MemoryLane',
  args: ['/Applications/MemoryLane-old.app/Contents/Resources/app.asar/out/main/mcp-entry.js'],
  env: { ELECTRON_RUN_AS_NODE: '1' },
}

const FOREIGN_ENTRY = {
  command: '/opt/custom/thing',
  args: ['--serve'],
}

// The three getStatus functions share identical logic; assert one per platform
// shape so each file path is exercised, then run the full matrix once on Claude
// Desktop as the representative case.

describe('getClaudeDesktopStatus', () => {
  beforeEach(() => clearClaudeDesktopConfig())

  it('not-registered when config file is missing', () => {
    expect(getClaudeDesktopStatus()).toBe('not-registered')
  })

  it('not-registered when config file has no memorylane entry', () => {
    const configPath = claudeDesktopConfigPath()
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: {} }))
    expect(getClaudeDesktopStatus()).toBe('not-registered')
  })

  it('current when entry matches the running app', () => {
    writeClaudeDesktopConfig(CURRENT_ENTRY)
    expect(getClaudeDesktopStatus()).toBe('current')
  })

  it('current when entry also carries a preserved --db-path', () => {
    writeClaudeDesktopConfig({
      ...CURRENT_ENTRY,
      args: [...CURRENT_ENTRY.args, '--db-path', '/tmp/team.db'],
    })
    expect(getClaudeDesktopStatus()).toBe('current')
  })

  it('stale when entry is the old npx CLI shape', () => {
    writeClaudeDesktopConfig(STALE_NPX_ENTRY)
    expect(getClaudeDesktopStatus()).toBe('stale')
  })

  it('stale when entry points at a moved .app', () => {
    writeClaudeDesktopConfig(STALE_MOVED_APP_ENTRY)
    expect(getClaudeDesktopStatus()).toBe('stale')
  })

  it('current (not stale) when foreign entry has no legacy fingerprint', () => {
    writeClaudeDesktopConfig(FOREIGN_ENTRY)
    expect(getClaudeDesktopStatus()).toBe('current')
  })
})

// Windows MSIX-specific cases: fresh MSIX installs of Claude Desktop read
// their config from %LOCALAPPDATA%\Packages\Claude_*\... instead of
// %APPDATA%\Claude\..., so we must discover and dual-write those paths.
describe.runIf(process.platform === 'win32')('getClaudeDesktopStatus — Windows MSIX', () => {
  beforeEach(() => clearClaudeDesktopConfig())

  it('not-registered when neither classic nor MSIX config exists', () => {
    expect(getClaudeDesktopStatus()).toBe('not-registered')
  })

  it('not-registered when Packages dir is absent (no MSIX install)', () => {
    expect(fs.existsSync(msixPackagesDir())).toBe(false)
    expect(getClaudeDesktopStatus()).toBe('not-registered')
  })

  it('stale when only the MSIX path is current (classic missing) — prompts reconnect to backfill classic', () => {
    writeMsixConfig(CURRENT_ENTRY)
    expect(getClaudeDesktopStatus()).toBe('stale')
  })

  it('stale when only the classic path is current (MSIX package exists but has no config)', () => {
    writeClaudeDesktopConfig(CURRENT_ENTRY)
    // Materialize an empty MSIX package dir so discovery yields the path.
    fs.mkdirSync(path.dirname(msixConfigPath()), { recursive: true })
    expect(getClaudeDesktopStatus()).toBe('stale')
  })

  it('stale when only the MSIX path has a legacy entry', () => {
    writeMsixConfig(STALE_NPX_ENTRY)
    expect(getClaudeDesktopStatus()).toBe('stale')
  })

  it('stale when classic is stale and MSIX is current', () => {
    writeClaudeDesktopConfig(STALE_NPX_ENTRY)
    writeMsixConfig(CURRENT_ENTRY)
    expect(getClaudeDesktopStatus()).toBe('stale')
  })

  it('stale when classic is current and MSIX is stale', () => {
    writeClaudeDesktopConfig(CURRENT_ENTRY)
    writeMsixConfig(STALE_MOVED_APP_ENTRY)
    expect(getClaudeDesktopStatus()).toBe('stale')
  })

  it('current when both classic and MSIX paths have current entries', () => {
    writeClaudeDesktopConfig(CURRENT_ENTRY)
    writeMsixConfig(CURRENT_ENTRY)
    expect(getClaudeDesktopStatus()).toBe('current')
  })

  it('discovers a non-default Claude_* package name', () => {
    // Simulate Anthropic re-signing the MSIX with a different publisher hash:
    // fill classic + alternate-named MSIX with current entries so 'current'
    // only reports if discovery actually found the alternate path.
    writeClaudeDesktopConfig(CURRENT_ENTRY)
    writeMsixConfig(CURRENT_ENTRY, 'Claude_abcdefghijklm')
    expect(getClaudeDesktopStatus()).toBe('current')
  })
})

describe.runIf(process.platform === 'win32')('registerWithClaudeDesktop — Windows MSIX', () => {
  beforeEach(() => clearClaudeDesktopConfig())

  it('writes to both classic and MSIX paths when an MSIX package is present', async () => {
    // Make an MSIX package dir exist so discovery finds it, but without a config.
    fs.mkdirSync(path.dirname(msixConfigPath()), { recursive: true })

    const result = await registerWithClaudeDesktop()
    expect(result).toBe(true)

    const classic = JSON.parse(fs.readFileSync(claudeDesktopConfigPath(), 'utf-8'))
    expect(classic.mcpServers?.memorylane).toEqual(CURRENT_ENTRY)
    const msix = JSON.parse(fs.readFileSync(msixConfigPath(), 'utf-8'))
    expect(msix.mcpServers?.memorylane).toEqual(CURRENT_ENTRY)
  })

  it('writes only to the classic path when no MSIX package is present', async () => {
    expect(fs.existsSync(msixPackagesDir())).toBe(false)

    const result = await registerWithClaudeDesktop()
    expect(result).toBe(true)

    const classic = JSON.parse(fs.readFileSync(claudeDesktopConfigPath(), 'utf-8'))
    expect(classic.mcpServers?.memorylane).toEqual(CURRENT_ENTRY)
    expect(fs.existsSync(msixConfigPath())).toBe(false)
  })

  it("preserves a user's --db-path even when it lives only in the MSIX config", async () => {
    writeMsixConfig({
      ...CURRENT_ENTRY,
      args: [...CURRENT_ENTRY.args, '--db-path', 'C:\\data\\team.db'],
    })

    const result = await registerWithClaudeDesktop()
    expect(result).toBe(true)

    const classic = JSON.parse(fs.readFileSync(claudeDesktopConfigPath(), 'utf-8'))
    expect(classic.mcpServers?.memorylane?.args).toEqual([
      ...CURRENT_ENTRY.args,
      '--db-path',
      'C:\\data\\team.db',
    ])
    const msix = JSON.parse(fs.readFileSync(msixConfigPath(), 'utf-8'))
    expect(msix.mcpServers?.memorylane?.args).toEqual([
      ...CURRENT_ENTRY.args,
      '--db-path',
      'C:\\data\\team.db',
    ])
  })

  it('preserves unrelated top-level keys in the MSIX config', async () => {
    // Replicates the real file we saw on the user's box, which carries a
    // `preferences` block alongside mcpServers.
    const configPath = msixConfigPath()
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        preferences: { coworkWebSearchEnabled: true },
      }),
    )

    const result = await registerWithClaudeDesktop()
    expect(result).toBe(true)

    const msix = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    expect(msix.preferences).toEqual({ coworkWebSearchEnabled: true })
    expect(msix.mcpServers?.memorylane).toEqual(CURRENT_ENTRY)
  })
})

describe('getClaudeCodeStatus', () => {
  it('not-registered when settings file is missing', () => {
    fs.rmSync(path.join(TMP_HOME, '.claude', 'settings.json'), { force: true })
    expect(getClaudeCodeStatus()).toBe('not-registered')
  })

  it('current when entry matches the running app', () => {
    writeClaudeCodeSettings(CURRENT_ENTRY)
    expect(getClaudeCodeStatus()).toBe('current')
  })

  it('stale when entry is the npx CLI shape', () => {
    writeClaudeCodeSettings(STALE_NPX_ENTRY)
    expect(getClaudeCodeStatus()).toBe('stale')
  })
})

describe('getCursorStatus', () => {
  it('not-registered when config file is missing', () => {
    fs.rmSync(path.join(TMP_HOME, '.cursor', 'mcp.json'), { force: true })
    expect(getCursorStatus()).toBe('not-registered')
  })

  it('current when entry matches the running app', () => {
    writeCursorConfig(CURRENT_ENTRY)
    expect(getCursorStatus()).toBe('current')
  })

  it('stale when entry points at a moved .app', () => {
    writeCursorConfig(STALE_MOVED_APP_ENTRY)
    expect(getCursorStatus()).toBe('stale')
  })
})
