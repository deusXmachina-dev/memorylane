import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Guard: the MCP DB-path config file must never be imported by recorder code.
 * The recorder uses `getDefaultDbPath()` directly so that `set_db_path` (which
 * writes to ~/.config/memorylane/cli.json) cannot re-route active recordings.
 *
 * Scans everything under `src/main/` except:
 *   - `src/main/mcp/**`         — legitimate consumer
 *   - `src/main/mcp-entry.ts`   — legitimate consumer
 */

const FORBIDDEN_SYMBOLS = [
  'resolveDbPath',
  'setDbPath',
  'clearDbPath',
  'getConfigDbPath',
  'getConfigFilePath',
]
const FORBIDDEN_MODULE_RE = /mcp\/config/ // any import targeting src/main/mcp/config

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    else if (entry.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx'))) acc.push(full)
  }
  return acc
}

function findProjectRoot(startDir: string): string {
  let dir = startDir
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    dir = path.dirname(dir)
  }
  throw new Error('Could not find project root')
}

describe('MCP config isolation', () => {
  it('is not imported by any recorder code', () => {
    const projectRoot = findProjectRoot(__dirname)
    const mainDir = path.join(projectRoot, 'src', 'main')
    const mcpDir = path.join(mainDir, 'mcp')
    const mcpEntry = path.join(mainDir, 'mcp-entry.ts')

    const offenders: Array<{ file: string; line: number; reason: string }> = []

    for (const file of walk(mainDir)) {
      if (file.startsWith(mcpDir + path.sep) || file === mcpEntry) continue
      const lines = fs.readFileSync(file, 'utf-8').split('\n')
      lines.forEach((text, idx) => {
        // Only flag import/require lines — avoid matching the string literal
        // "setDbPath" in e.g. documentation comments.
        const isImport = /^\s*import\b|require\(/.test(text)
        if (!isImport) return
        if (FORBIDDEN_MODULE_RE.test(text)) {
          offenders.push({ file, line: idx + 1, reason: `imports from mcp/config: ${text.trim()}` })
          return
        }
        for (const sym of FORBIDDEN_SYMBOLS) {
          if (text.includes(sym)) {
            offenders.push({
              file,
              line: idx + 1,
              reason: `imports forbidden symbol ${sym}: ${text.trim()}`,
            })
            return
          }
        }
      })
    }

    if (offenders.length > 0) {
      const report = offenders.map((o) => `  ${o.file}:${o.line} — ${o.reason}`).join('\n')
      throw new Error(
        `Recorder code must not import MCP-only DB-path config (set_db_path must never route recordings). Offenders:\n${report}`,
      )
    }
    expect(offenders).toEqual([])
  })
})
