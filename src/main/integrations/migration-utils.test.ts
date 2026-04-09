import { describe, it, expect } from 'vitest'
import { detectStaleSignal, isStaleMcpEntry, isCurrentCliEntry } from './migration-utils'

describe('isStaleMcpEntry', () => {
  describe('returns true for old in-asar entries', () => {
    it('detects macOS entry with full env, command, and args (the original shape)', () => {
      const entry = {
        command: '/Applications/MemoryLane.app/Contents/MacOS/MemoryLane',
        args: ['/Applications/MemoryLane.app/Contents/Resources/app.asar/out/main/mcp-entry.js'],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      }
      expect(isStaleMcpEntry(entry)).toBe(true)
    })

    it('detects macOS entry where env was stripped (the screenshot case)', () => {
      const entry = {
        command: '/Applications/MemoryLane.app/Contents/MacOS/MemoryLane',
        args: ['/Applications/MemoryLane.app/Contents/Resources/app.asar/out/main/mcp-entry.js'],
      }
      expect(isStaleMcpEntry(entry)).toBe(true)
    })

    it('detects MemoryLane Enterprise edition on macOS', () => {
      const entry = {
        command: '/Applications/MemoryLane Enterprise.app/Contents/MacOS/MemoryLane Enterprise',
        args: [
          '/Applications/MemoryLane Enterprise.app/Contents/Resources/app.asar/out/main/mcp-entry.js',
        ],
      }
      expect(isStaleMcpEntry(entry)).toBe(true)
    })

    it('detects Windows entry by command path and mcp-entry.js arg', () => {
      const entry = {
        command: 'C:\\Program Files\\MemoryLane\\MemoryLane.exe',
        args: ['C:\\Program Files\\MemoryLane\\resources\\app.asar\\out\\main\\mcp-entry.js'],
      }
      expect(isStaleMcpEntry(entry)).toBe(true)
    })

    it('detects entry with only the env signal (command/args replaced by user)', () => {
      const entry = {
        command: '/usr/local/bin/node',
        args: ['/some/wrapper.js'],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      }
      expect(isStaleMcpEntry(entry)).toBe(true)
    })

    it('detects entry by mcp-entry.js arg alone, even when command was renamed', () => {
      const entry = {
        command: 'electron',
        args: ['out/main/mcp-entry.js'],
      }
      expect(isStaleMcpEntry(entry)).toBe(true)
    })

    it('detects entry by packaged binary command alone (args wiped)', () => {
      const entry = {
        command: '/Applications/MemoryLane.app/Contents/MacOS/MemoryLane',
        args: [],
      }
      expect(isStaleMcpEntry(entry)).toBe(true)
    })
  })

  describe('returns false for current and unrelated entries', () => {
    it('does not flag the current CLI entry', () => {
      const entry = {
        command: 'npx',
        args: ['-y', '-p', '@deusxmachina-dev/memorylane-cli', 'memorylane-mcp'],
      }
      expect(isStaleMcpEntry(entry)).toBe(false)
    })

    it('does not flag the current CLI entry with stdio type', () => {
      const entry = {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '-p', '@deusxmachina-dev/memorylane-cli', 'memorylane-mcp'],
      }
      expect(isStaleMcpEntry(entry)).toBe(false)
    })

    it('does not flag an unrelated MCP server', () => {
      const entry = {
        command: 'node',
        args: ['/some/other/server.js'],
      }
      expect(isStaleMcpEntry(entry)).toBe(false)
    })

    it('does not flag an entry whose env has a different value', () => {
      const entry = {
        command: 'node',
        args: ['/some/server.js'],
        env: { ELECTRON_RUN_AS_NODE: '0', SOMETHING_ELSE: '1' },
      }
      expect(isStaleMcpEntry(entry)).toBe(false)
    })

    it('handles undefined entry', () => {
      expect(isStaleMcpEntry(undefined)).toBe(false)
    })

    it('handles malformed entry (missing fields)', () => {
      expect(isStaleMcpEntry({} as never)).toBe(false)
    })

    it('does not flag an entry whose command happens to contain MemoryLane in a folder name', () => {
      const entry = {
        command: '/Users/me/MemoryLane-projects/bin/some-server',
        args: [],
      }
      expect(isStaleMcpEntry(entry)).toBe(false)
    })
  })
})

describe('detectStaleSignal', () => {
  it('reports the env signal when only env matches', () => {
    expect(
      detectStaleSignal({
        command: 'node',
        args: ['/x.js'],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      }),
    ).toBe('electron-run-as-node-env')
  })

  it('reports the args signal when only args match', () => {
    expect(
      detectStaleSignal({
        command: 'electron',
        args: ['out/main/mcp-entry.js'],
      }),
    ).toBe('mcp-entry-js-arg')
  })

  it('reports the binary signal when only command matches', () => {
    expect(
      detectStaleSignal({
        command: '/Applications/MemoryLane.app/Contents/MacOS/MemoryLane',
        args: [],
      }),
    ).toBe('packaged-app-binary')
  })
})

describe('isCurrentCliEntry', () => {
  it('matches the canonical CLI entry', () => {
    expect(
      isCurrentCliEntry({
        command: 'npx',
        args: ['-y', '-p', '@deusxmachina-dev/memorylane-cli', 'memorylane-mcp'],
      }),
    ).toBe(true)
  })

  it('rejects an npx entry pointing at a different package', () => {
    expect(
      isCurrentCliEntry({
        command: 'npx',
        args: ['-y', 'some-other-mcp'],
      }),
    ).toBe(false)
  })

  it('rejects a non-npx command', () => {
    expect(
      isCurrentCliEntry({
        command: 'node',
        args: ['@deusxmachina-dev/memorylane-cli'],
      }),
    ).toBe(false)
  })

  it('handles undefined', () => {
    expect(isCurrentCliEntry(undefined)).toBe(false)
  })
})
