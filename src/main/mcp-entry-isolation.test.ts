import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'

/**
 * Guard: the MCP entry point runs under ELECTRON_RUN_AS_NODE=1, so the
 * `electron` module is not resolvable at require time. No file in the static
 * import graph starting at `src/main/mcp-entry.ts` may contain a top-level
 * (non-type) import from `'electron'`, because ES imports are hoisted and
 * would crash the MCP process before `main()` runs.
 *
 * Electron APIs may still be consulted lazily via `require('electron')`
 * inside a try/catch — see `getElectronAppOrNull()` in `src/main/paths.ts`.
 *
 * This test reproduces the class of regression from the bug where
 * `edition.ts` had `import { app } from 'electron'`, which Rollup placed in
 * a shared chunk that the MCP entry transitively required.
 *
 * Implementation notes:
 * - Uses the TypeScript compiler API (not a regex) so multi-line imports,
 *   inline `{ type X }` bindings, and comments are all handled correctly.
 * - Only follows relative import specifiers. `src/main` uses relative
 *   imports throughout; path aliases (`@/…`, `@components/…`) are not
 *   traversed. This is an audit, not a proof: if `src/main` ever adopts
 *   aliased imports, extend `extractRelativeImportSpecifiers` to resolve
 *   them via the `tsconfig.node.json` `paths` map.
 */

const PROJECT_ROOT = findProjectRoot(__dirname)
const MAIN_DIR = path.join(PROJECT_ROOT, 'src', 'main')
const MCP_ENTRY = path.join(MAIN_DIR, 'mcp-entry.ts')

describe('MCP entry electron isolation', () => {
  it('fileImportsElectronAtRuntime classifies all relevant import forms', () => {
    // Self-check: if this helper regresses, the main test below would
    // silently pass even when offenders exist. Pin the behaviour.
    const shouldFlag: Array<[string, string]> = [
      ['named value import', `import { app } from 'electron'`],
      ['multiple named value imports', `import { app, BrowserWindow } from "electron"`],
      ['namespace import', `import * as electron from 'electron'`],
      ['default import', `import electron from 'electron'`],
      ['side-effect import', `import 'electron'`],
      [
        'multi-line named import',
        `import {
           app,
           BrowserWindow,
         } from 'electron'`,
      ],
      ['mixed type + value named import', `import { app, type App } from 'electron'`],
    ]
    const shouldNotFlag: Array<[string, string]> = [
      ['type-only import', `import type { App } from 'electron'`],
      ['type-only multi-named', `import type { App, BrowserWindow } from 'electron'`],
      ['all-inline-type named import', `import { type App, type BrowserWindow } from 'electron'`],
      ['similarly-named relative import', `import { something } from './electron-helpers'`],
      ['commented-out import', `// import { app } from 'electron' — historical note`],
      ['lazy require in expression', `const electron = require('electron')`],
    ]
    for (const [label, source] of shouldFlag) {
      expect(fileImportsElectronAtRuntime(source), `should flag: ${label}`).toBe(true)
    }
    for (const [label, source] of shouldNotFlag) {
      expect(fileImportsElectronAtRuntime(source), `should not flag: ${label}`).toBe(false)
    }
  })

  it('no file in the mcp-entry import graph statically imports electron', () => {
    const visited = new Set<string>()
    const offenders: Array<{ file: string; line: number; text: string }> = []

    function visit(file: string): void {
      if (visited.has(file)) return
      visited.add(file)

      const source = fs.readFileSync(file, 'utf-8')
      const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)

      for (const stmt of sf.statements) {
        if (!ts.isImportDeclaration(stmt)) continue
        if (!importsElectronAtRuntime(stmt)) continue
        const { line } = sf.getLineAndCharacterOfPosition(stmt.getStart(sf))
        offenders.push({
          file,
          line: line + 1,
          text: stmt.getText(sf).replace(/\s+/g, ' ').trim(),
        })
      }

      for (const spec of extractRelativeImportSpecifiers(sf)) {
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

/**
 * Returns true iff the source contains a top-level ES import from `'electron'`
 * that will emit a runtime `require('electron')`. Type-only imports (either at
 * the declaration level — `import type …` — or entirely via inline
 * `{ type X }` specifiers) are stripped by the TS compiler and are safe.
 */
function fileImportsElectronAtRuntime(source: string): boolean {
  const sf = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true)
  return sf.statements.some(
    (stmt) => ts.isImportDeclaration(stmt) && importsElectronAtRuntime(stmt),
  )
}

function importsElectronAtRuntime(stmt: ts.ImportDeclaration): boolean {
  const spec = stmt.moduleSpecifier
  if (!ts.isStringLiteral(spec) || spec.text !== 'electron') return false

  const clause = stmt.importClause
  // Side-effect import: `import 'electron'` — always runtime.
  if (!clause) return true
  // `import type { … } from 'electron'`
  if (clause.isTypeOnly) return false

  const hasDefault = !!clause.name
  const bindings = clause.namedBindings
  if (bindings && ts.isNamespaceImport(bindings)) return true
  if (bindings && ts.isNamedImports(bindings)) {
    const hasRuntimeNamed = bindings.elements.some((el) => !el.isTypeOnly)
    if (hasRuntimeNamed) return true
    // All named bindings are inline-type-only.
    return hasDefault
  }
  return hasDefault
}

function extractRelativeImportSpecifiers(sf: ts.SourceFile): string[] {
  const specifiers: string[] = []
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue
    const spec = stmt.moduleSpecifier
    if (!ts.isStringLiteral(spec)) continue
    if (spec.text.startsWith('./') || spec.text.startsWith('../')) {
      specifiers.push(spec.text)
    }
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
