/**
 * Electron MCP entry point.
 *
 * Invoked by integration clients (Claude Desktop, Claude Code, Cursor) via:
 *   command: /Applications/MemoryLane.app/Contents/MacOS/MemoryLane
 *   args:    [<path to this file>]
 *   env:     { ELECTRON_RUN_AS_NODE: "1" }
 *
 * Under ELECTRON_RUN_AS_NODE=1 Electron behaves as vanilla Node, so this
 * script runs without the main app ever starting. Mirrors the CLI's
 * `packages/cli/src/mcp.ts` — the `set_db_path` tool is inherited from the
 * shared server registration in `src/main/mcp/tools.ts`.
 */

import { Writable } from 'node:stream'
import { setLogger } from './logger'
import { MemoryLaneMCPServer } from './mcp/server'
import { getDefaultDbPath } from './paths'
import { resolveDbPath } from './mcp/config'

// ---------------------------------------------------------------------------
// Module init — runs after imports have resolved (ESM hoists imports) but
// before `main()` is scheduled. Keeping all of this at module scope means
// the stdout swap is in place before the MCP server ever touches stdout.
// ---------------------------------------------------------------------------

// Parse flags.
const argv = process.argv.slice(2)
let dbPathArg: string | undefined
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--db-path' && argv[i + 1]) {
    dbPathArg = argv[++i]
  }
}

// Stdout capture — the MCP stdio protocol owns stdout exclusively. Redirect
// everything else to stderr and hand the real stdout to the server as an
// explicit Writable.
const realWrite = process.stdout.write.bind(process.stdout)
const mcpStdout = new Writable({
  write(chunk, encoding, callback): void {
    realWrite(chunk, encoding as BufferEncoding, callback)
  },
})
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write

// Silence the shared logger so nothing leaks onto the (now-redirected) stdout.
const noop = (): void => {}
setLogger({ debug: noop, info: noop })

async function main(): Promise<void> {
  const { dbPath } = resolveDbPath(dbPathArg, getDefaultDbPath)
  const server = new MemoryLaneMCPServer()
  await server.start(dbPath, mcpStdout)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
