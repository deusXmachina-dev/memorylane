import { describe, expect, it } from 'vitest'
import { formatBlockingHostNames, type UpdateBlockingMcpProcess } from './windows-update-blockers'

function createBlocker(hostName: string | null, pid: number): UpdateBlockingMcpProcess {
  return {
    pid,
    commandLine: 'MemoryLane.exe out/main/mcp-entry.js',
    host: hostName ? { pid: pid + 1000, name: hostName } : null,
  }
}

describe('formatBlockingHostNames', () => {
  it('deduplicates names and strips .exe suffixes', () => {
    const result = formatBlockingHostNames([
      createBlocker('Claude.exe', 1),
      createBlocker('claude.EXE', 2),
      createBlocker('Cursor.exe', 3),
    ])

    expect(result).toEqual(['Claude', 'Cursor'])
  })

  it('ignores blockers without a resolved host', () => {
    const result = formatBlockingHostNames([createBlocker(null, 1)])

    expect(result).toEqual([])
  })
})
