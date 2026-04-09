/**
 * Shared helpers for detecting old vs current MemoryLane MCP entries
 * across Claude Desktop, Claude Code, and Cursor configs.
 *
 * Background: in v0.18.0 the MCP server moved out of the Electron app
 * (out/main/mcp-entry.js running under ELECTRON_RUN_AS_NODE=1) and into
 * a standalone CLI invoked via `npx @deusxmachina-dev/memorylane-cli`.
 * Pre-v0.18 entries left over in user config files now point at a script
 * that no longer exists and surface as "Server disconnected" in clients.
 *
 * `isStaleMcpEntry` recognizes those old entries by multiple signals so
 * we can rewrite them on next launch even if `env` got stripped or
 * normalized by the client UI.
 */

export interface McpEntryShape {
  command?: unknown
  args?: unknown
  env?: unknown
}

/**
 * Detection signal: which fingerprint matched. Returned for diagnostics
 * so logs can pinpoint why an entry was treated as stale.
 */
export type StaleSignal = 'electron-run-as-node-env' | 'mcp-entry-js-arg' | 'packaged-app-binary'

/**
 * Returns the matched signal if `entry` looks like a pre-v0.18 in-asar
 * MemoryLane MCP entry, or `null` if it does not.
 *
 * Multiple independent signals are checked because real-world configs
 * have been observed in shapes the original `env`-only check missed:
 * Claude Desktop's UI re-serializes entries without preserving env, and
 * users sometimes hand-edit the file.
 */
export function detectStaleSignal(entry: McpEntryShape | undefined): StaleSignal | null {
  if (!entry || typeof entry !== 'object') return null

  // Signal 1: ELECTRON_RUN_AS_NODE env var (the original detection).
  const env = entry.env
  if (env && typeof env === 'object' && !Array.isArray(env)) {
    const electronEnv = (env as Record<string, unknown>).ELECTRON_RUN_AS_NODE
    if (electronEnv === '1') return 'electron-run-as-node-env'
  }

  // Signal 2: any arg references the deleted mcp-entry.js script.
  // No other MCP server in the wild ships a file with that exact name,
  // so this is the most specific fingerprint.
  if (Array.isArray(entry.args)) {
    for (const arg of entry.args) {
      if (typeof arg !== 'string') continue
      if (arg.endsWith('mcp-entry.js') || arg.includes('out/main/mcp-entry')) {
        return 'mcp-entry-js-arg'
      }
    }
  }

  // Signal 3: command points at the packaged MemoryLane Electron binary
  // (covers both 'MemoryLane' and 'MemoryLane Enterprise' editions on
  // macOS and Windows). Catches entries where args were edited away but
  // the command itself still references the host app.
  if (typeof entry.command === 'string' && isPackagedMemoryLaneBinary(entry.command)) {
    return 'packaged-app-binary'
  }

  return null
}

/** Convenience boolean wrapper around `detectStaleSignal`. */
export function isStaleMcpEntry(entry: McpEntryShape | undefined): boolean {
  return detectStaleSignal(entry) !== null
}

/**
 * Returns true if the entry already points at the new CLI invocation,
 * so the migration can skip rewriting it on every launch.
 */
export function isCurrentCliEntry(entry: McpEntryShape | undefined): boolean {
  if (!entry || typeof entry !== 'object') return false
  if (entry.command !== 'npx') return false
  if (!Array.isArray(entry.args)) return false
  return entry.args.some(
    (arg) => typeof arg === 'string' && arg.includes('@deusxmachina-dev/memorylane-cli'),
  )
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
