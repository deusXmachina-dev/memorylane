import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Guard: the MCP entry point runs under ELECTRON_RUN_AS_NODE=1, so the
 * `electron` module is not resolvable at require time. No file in the static
 * import graph starting at `src/main/mcp-entry.ts` may contain a top-level
 * (non-type) import from `'electron'`, because ES imports are hoisted and
 * would crash the MCP process before `main()` runs.
 *
 * Electron APIs may still be consulted lazily via `require('electron')`
 * inside a try/catch — see `getElectronApp()` in `src/main/edition.ts` and
 * `getBundledModelPath()` in `src/main/paths.ts`.
 *
 * This test reproduces the class of regression from the bug where
 * `edition.ts` had `import { app } from 'electron'`, which Rollup placed in
 * a shared chunk that the MCP entry transitively required.
 */

const PROJECT_ROOT = findProjectRoot(__dirname)
const MAIN_DIR = path.join(PROJECT_ROOT, 'src', 'main')
const MCP_ENTRY = path.join(MAIN_DIR, 'mcp-entry.ts')

// Matches ES imports like `import ... from 'electron'` and side-effect
// `import 'electron'`, but NOT `import type ... from 'electron'` — type
// imports are stripped by the TS compiler and emit no runtime require.
const FORBIDDEN_IMPORT_RE = /^\s*import\s+(?!type\b)(?:[^'"]*\s+from\s+)?['"]electron['"]\s*;?\s*$/

describe('MCP entry electron isolation', () => {
  it('FORBIDDEN_IMPORT_RE matches the patterns it is meant to catch', () => {
    // Self-check: if this regex regresses, the main test below would
    // silently pass even when offenders exist. Pin the behaviour.
    const shouldMatch = [
      `import { app } from 'electron'`,
      `import { app, BrowserWindow } from "electron"`,
      `import * as electron from 'electron'`,
      `import electron from 'electron'`,
      `import 'electron'`,
      `  import { app } from 'electron';`,
    ]
    const shouldNotMatch = [
      `import type { App } from 'electron'`,
      `import type { App, BrowserWindow } from 'electron'`,
      `import { something } from './electron-helpers'`,
      `// import { app } from 'electron' — historical note`,
      `const electron = require('electron')`,
    ]
    for (const line of shouldMatch) {
      expect(FORBIDDEN_IMPORT_RE.test(line), `should match: ${line}`).toBe(true)
    }
    for (const line of shouldNotMatch) {
      expect(FORBIDDEN_IMPORT_RE.test(line), `should not match: ${line}`).toBe(false)
    }
  })

  it('no file in the mcp-entry import graph statically imports electron', () => {
    const visited = new Set<string>()
    const offenders: Array<{ file: string; line: number; text: string }> = []

    function visit(file: string): void {
      if (visited.has(file)) return
      visited.add(file)

      const source = fs.readFileSync(file, 'utf-8')
      const lines = source.split('\n')

      lines.forEach((text, idx) => {
        if (FORBIDDEN_IMPORT_RE.test(text)) {
          offenders.push({ file, line: idx + 1, text: text.trim() })
        }
      })

      for (const spec of extractRelativeImportSpecifiers(source)) {
        const resolved = resolveRelativeImport(file, spec)
        if (resolved) visit(resolved)
      }
    }

    visit(MCP_ENTRY)

    if (offenders.length > 0) {
      const report = offenders
        .map((o) => `  ${path.relative(PROJECT_ROOT, o.file)}:${o.line} — ${o.text}`)
        .join('\n')
      throw new Error(
        `MCP entry chain must not statically import 'electron' (the MCP process runs under ` +
          `ELECTRON_RUN_AS_NODE=1, where the module is unresolvable). Use a lazy ` +
          `try/require('electron') pattern instead. Offenders:\n${report}`,
      )
    }
    expect(offenders).toEqual([])
  })
})

function extractRelativeImportSpecifiers(source: string): string[] {
  // Match `import ... from './foo'` / `import ... from '../foo'` and
  // side-effect `import './foo'`. Non-relative specifiers (npm packages,
  // path aliases) are ignored — we only follow relative imports within
  // src/main, which is where the regression surface lives.
  const specifiers: string[] = []
  const importRe = /import\s+(?:[^'"]*?\s+from\s+)?['"](\.\.?\/[^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = importRe.exec(source)) !== null) {
    specifiers.push(match[1])
  }
  return specifiers
}

function resolveRelativeImport(fromFile: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier)
  const candidates = [
    base + '.ts',
    base + '.tsx',
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

function findProjectRoot(startDir: string): string {
  let dir = startDir
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    dir = path.dirname(dir)
  }
  throw new Error('Could not find project root')
}
