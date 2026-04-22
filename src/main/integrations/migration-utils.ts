/**
 * Shared helpers for detecting stale vs current MemoryLane MCP entries
 * across Claude Desktop, Claude Code, and Cursor configs.
 *
 * Timeline of entry shapes:
 *   v0 (pre-v0.18) — Electron app-as-node: command=MemoryLane binary,
 *                    args=[.../mcp-entry.js], env={ELECTRON_RUN_AS_NODE: '1'}.
 *   v1 (v0.18+)    — CLI via npx: command='npx',
 *                    args=['-y', '-p', '@deusxmachina-dev/memorylane-cli', 'memorylane-mcp'].
 *   v2 (current)   — Electron app-as-node again, now with multi-DB support
 *                    and shared server code. Same shape as v0 but the .app
 *                    path may vary (user moved it, upgraded, switched edition).
 *
 * The per-integration `getXStatus` helpers use these fingerprints to surface a
 * 'stale' state in the Integrations UI so the user can reconnect explicitly —
 * no config file is rewritten until they do. `extractDbPathArg` is what lets
 * a user-added `--db-path <value>` survive the reconnect.
 */

export interface McpEntryShape {
  command?: unknown
  args?: unknown
  env?: unknown
}

/**
 * Which fingerprint matched a legacy entry. Returned for diagnostics so logs
 * can pinpoint why an entry was treated as stale.
 */
export type LegacySignal =
  | 'npx-memorylane-cli'
  | 'electron-run-as-node-env'
  | 'mcp-entry-js-arg'
  | 'packaged-app-binary'

/**
 * Detects the v1 CLI shape: `npx ... @deusxmachina-dev/memorylane-cli`.
 */
export function detectLegacyNpxSignal(entry: McpEntryShape | undefined): LegacySignal | null {
  if (!entry || typeof entry !== 'object') return null
  if (entry.command !== 'npx') return null
  if (!Array.isArray(entry.args)) return null
  const hit = entry.args.some(
    (arg) => typeof arg === 'string' && arg.includes('@deusxmachina-dev/memorylane-cli'),
  )
  return hit ? 'npx-memorylane-cli' : null
}

/**
 * Detects any Electron app-as-node shape (v0 or an outdated v2 pointing at a
 * moved `.app`). This is deliberately broad — the caller should first check
 * `isCurrentAppEntry` against the current app's exe + script path and only
 * call into `detectLegacyAppSignal` as a fallback.
 */
export function detectLegacyAppSignal(entry: McpEntryShape | undefined): LegacySignal | null {
  if (!entry || typeof entry !== 'object') return null

  // Signal 1: ELECTRON_RUN_AS_NODE env var.
  const env = entry.env
  if (env && typeof env === 'object' && !Array.isArray(env)) {
    const electronEnv = (env as Record<string, unknown>).ELECTRON_RUN_AS_NODE
    if (electronEnv === '1') return 'electron-run-as-node-env'
  }

  // Signal 2: any arg references an mcp-entry.js script.
  if (Array.isArray(entry.args)) {
    for (const arg of entry.args) {
      if (typeof arg !== 'string') continue
      if (arg.endsWith('mcp-entry.js') || arg.includes('out/main/mcp-entry')) {
        return 'mcp-entry-js-arg'
      }
    }
  }

  // Signal 3: command points at a packaged MemoryLane binary.
  if (typeof entry.command === 'string' && isPackagedMemoryLaneBinary(entry.command)) {
    return 'packaged-app-binary'
  }

  return null
}

/**
 * Returns true if the entry already matches the current Electron app entry
 * (exe + script + ELECTRON_RUN_AS_NODE=1). The caller passes in the current
 * paths so this function stays pure and testable without importing `electron`.
 */
export function isCurrentAppEntry(
  entry: McpEntryShape | undefined,
  currentExePath: string,
  currentScriptPath: string,
): boolean {
  if (!entry || typeof entry !== 'object') return false
  if (entry.command !== currentExePath) return false
  if (!Array.isArray(entry.args)) return false
  if (!entry.args.includes(currentScriptPath)) return false
  const env = entry.env
  if (!env || typeof env !== 'object' || Array.isArray(env)) return false
  return (env as Record<string, unknown>).ELECTRON_RUN_AS_NODE === '1'
}

/**
 * Extracts a `--db-path <value>` pair from an args array, if present.
 * Returns the value only (not the flag). Used to preserve user-added
 * multi-DB routing across migrations.
 */
export function extractDbPathArg(args: unknown): string | undefined {
  if (!Array.isArray(args)) return undefined
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '--db-path' && typeof args[i + 1] === 'string') {
      return args[i + 1] as string
    }
  }
  return undefined
}

function isPackagedMemoryLaneBinary(command: string): boolean {
  // macOS: .../MemoryLane.app/Contents/MacOS/MemoryLane
  //        .../MemoryLane Enterprise.app/Contents/MacOS/MemoryLane Enterprise
  if (command.includes('.app/Contents/MacOS/')) {
    const tail = command.split('/').pop() ?? ''
    if (tail === 'MemoryLane' || tail === 'MemoryLane Enterprise') return true
  }
  // Windows: ...\MemoryLane.exe or ...\MemoryLane Enterprise.exe
  const winTail = command.split(/[\\/]/).pop() ?? ''
  if (winTail === 'MemoryLane.exe' || winTail === 'MemoryLane Enterprise.exe') return true
  return false
}
