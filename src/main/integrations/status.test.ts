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

import { getClaudeDesktopStatus } from './claude-desktop'
import { getClaudeCodeStatus } from './claude-code'
import { getCursorStatus } from './cursor'

afterAll(() => {
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
      return path.join(
        process.env.APPDATA || path.join(TMP_HOME, 'AppData', 'Roaming'),
        'Claude',
        'claude_desktop_config.json',
      )
    default:
      return path.join(TMP_HOME, '.config', 'Claude', 'claude_desktop_config.json')
  }
}

function writeClaudeDesktopConfig(entry: unknown): void {
  const configPath = claudeDesktopConfigPath()
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
