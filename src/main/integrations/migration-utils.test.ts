import { describe, it, expect } from 'vitest'
import {
  detectLegacyAppSignal,
  detectLegacyNpxSignal,
  extractDbPathArg,
  isCurrentAppEntry,
} from './migration-utils'

// Fixed paths used to stand in for the "current" app's exe + mcp-entry.js
// so these tests don't need to import electron.
const CURRENT_EXE = '/Applications/MemoryLane.app/Contents/MacOS/MemoryLane'
const CURRENT_SCRIPT =
  '/Applications/MemoryLane.app/Contents/Resources/app.asar/out/main/mcp-entry.js'

describe('detectLegacyNpxSignal', () => {
  it('matches the canonical v1 CLI entry', () => {
    expect(
      detectLegacyNpxSignal({
        command: 'npx',
        args: ['-y', '-p', '@deusxmachina-dev/memorylane-cli', 'memorylane-mcp'],
      }),
    ).toBe('npx-memorylane-cli')
  })

  it('matches the v1 entry with stdio type', () => {
    expect(
      detectLegacyNpxSignal({
        type: 'stdio',
        command: 'npx',
        args: ['-y', '-p', '@deusxmachina-dev/memorylane-cli', 'memorylane-mcp'],
      } as never),
    ).toBe('npx-memorylane-cli')
  })

  it('matches the v1 entry with preserved --db-path args', () => {
    expect(
      detectLegacyNpxSignal({
        command: 'npx',
        args: [
          '-y',
          '-p',
          '@deusxmachina-dev/memorylane-cli',
          'memorylane-mcp',
          '--db-path',
          '/tmp/team.db',
        ],
      }),
    ).toBe('npx-memorylane-cli')
  })

  it('rejects an npx entry pointing at a different package', () => {
    expect(
      detectLegacyNpxSignal({
        command: 'npx',
        args: ['-y', 'some-other-mcp'],
      }),
    ).toBe(null)
  })

  it('rejects a non-npx command', () => {
    expect(
      detectLegacyNpxSignal({
        command: 'node',
        args: ['@deusxmachina-dev/memorylane-cli'],
      }),
    ).toBe(null)
  })

  it('handles undefined', () => {
    expect(detectLegacyNpxSignal(undefined)).toBe(null)
  })
})

describe('detectLegacyAppSignal', () => {
  it('detects an entry with ELECTRON_RUN_AS_NODE env', () => {
    expect(
      detectLegacyAppSignal({
        command: '/usr/local/bin/node',
        args: ['/some/wrapper.js'],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      }),
    ).toBe('electron-run-as-node-env')
  })

  it('detects an entry by an mcp-entry.js arg', () => {
    expect(
      detectLegacyAppSignal({
        command: 'electron',
        args: ['out/main/mcp-entry.js'],
      }),
    ).toBe('mcp-entry-js-arg')
  })

  it('detects an entry by packaged MemoryLane binary command', () => {
    expect(
      detectLegacyAppSignal({
        command: '/Applications/MemoryLane.app/Contents/MacOS/MemoryLane',
        args: [],
      }),
    ).toBe('packaged-app-binary')
  })

  it('detects MemoryLane Enterprise edition on macOS', () => {
    // No env → falls through to args match.
    expect(
      detectLegacyAppSignal({
        command: '/Applications/MemoryLane Enterprise.app/Contents/MacOS/MemoryLane Enterprise',
        args: [
          '/Applications/MemoryLane Enterprise.app/Contents/Resources/app.asar/out/main/mcp-entry.js',
        ],
      }),
    ).toBe('mcp-entry-js-arg')
  })

  it('detects a Windows entry by command path + args', () => {
    expect(
      detectLegacyAppSignal({
        command: 'C:\\Program Files\\MemoryLane\\MemoryLane.exe',
        args: ['C:\\Program Files\\MemoryLane\\resources\\app.asar\\out\\main\\mcp-entry.js'],
      }),
    ).toBe('mcp-entry-js-arg')
  })

  it('does not flag an unrelated MCP server', () => {
    expect(
      detectLegacyAppSignal({
        command: 'node',
        args: ['/some/other/server.js'],
      }),
    ).toBe(null)
  })

  it('does not flag an entry whose env has a different value', () => {
    expect(
      detectLegacyAppSignal({
        command: 'node',
        args: ['/some/server.js'],
        env: { ELECTRON_RUN_AS_NODE: '0', SOMETHING_ELSE: '1' },
      }),
    ).toBe(null)
  })

  it('does not flag a path that merely contains MemoryLane in a folder name', () => {
    expect(
      detectLegacyAppSignal({
        command: '/Users/me/MemoryLane-projects/bin/some-server',
        args: [],
      }),
    ).toBe(null)
  })

  it('handles undefined', () => {
    expect(detectLegacyAppSignal(undefined)).toBe(null)
  })
})

describe('isCurrentAppEntry', () => {
  it('matches the canonical current entry', () => {
    expect(
      isCurrentAppEntry(
        {
          command: CURRENT_EXE,
          args: [CURRENT_SCRIPT],
          env: { ELECTRON_RUN_AS_NODE: '1' },
        },
        CURRENT_EXE,
        CURRENT_SCRIPT,
      ),
    ).toBe(true)
  })

  it('matches current entry with trailing --db-path args', () => {
    expect(
      isCurrentAppEntry(
        {
          command: CURRENT_EXE,
          args: [CURRENT_SCRIPT, '--db-path', '/tmp/team.db'],
          env: { ELECTRON_RUN_AS_NODE: '1' },
        },
        CURRENT_EXE,
        CURRENT_SCRIPT,
      ),
    ).toBe(true)
  })

  it('rejects an entry pointing at a moved .app', () => {
    expect(
      isCurrentAppEntry(
        {
          command: '/Applications/MemoryLane-old.app/Contents/MacOS/MemoryLane',
          args: [
            '/Applications/MemoryLane-old.app/Contents/Resources/app.asar/out/main/mcp-entry.js',
          ],
          env: { ELECTRON_RUN_AS_NODE: '1' },
        },
        CURRENT_EXE,
        CURRENT_SCRIPT,
      ),
    ).toBe(false)
  })

  it('rejects an npx entry', () => {
    expect(
      isCurrentAppEntry(
        {
          command: 'npx',
          args: ['-y', '-p', '@deusxmachina-dev/memorylane-cli', 'memorylane-mcp'],
        },
        CURRENT_EXE,
        CURRENT_SCRIPT,
      ),
    ).toBe(false)
  })

  it('rejects an entry missing ELECTRON_RUN_AS_NODE', () => {
    expect(
      isCurrentAppEntry(
        { command: CURRENT_EXE, args: [CURRENT_SCRIPT] },
        CURRENT_EXE,
        CURRENT_SCRIPT,
      ),
    ).toBe(false)
  })

  it('handles undefined', () => {
    expect(isCurrentAppEntry(undefined, CURRENT_EXE, CURRENT_SCRIPT)).toBe(false)
  })
})

describe('extractDbPathArg', () => {
  it('extracts --db-path value from a CLI entry', () => {
    expect(
      extractDbPathArg([
        '-y',
        '-p',
        '@deusxmachina-dev/memorylane-cli',
        'memorylane-mcp',
        '--db-path',
        '/tmp/team.db',
      ]),
    ).toBe('/tmp/team.db')
  })

  it('extracts --db-path value from an app entry', () => {
    expect(extractDbPathArg([CURRENT_SCRIPT, '--db-path', '/tmp/team-a.db'])).toBe('/tmp/team-a.db')
  })

  it('returns undefined when no --db-path is present', () => {
    expect(extractDbPathArg([CURRENT_SCRIPT])).toBe(undefined)
  })

  it('returns undefined when --db-path has no following value', () => {
    expect(extractDbPathArg([CURRENT_SCRIPT, '--db-path'])).toBe(undefined)
  })

  it('handles non-array input', () => {
    expect(extractDbPathArg(undefined)).toBe(undefined)
    expect(extractDbPathArg('not an array')).toBe(undefined)
  })
})
