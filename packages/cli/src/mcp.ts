/**
 * Standalone MCP server entry point for the CLI package.
 *
 * Uses stdio transport for use with Claude Desktop, Cursor, and other MCP clients.
 */

// ---------------------------------------------------------------------------
// Parse flags BEFORE any side-effecting code.
// ---------------------------------------------------------------------------
const __argv = process.argv.slice(2)
let __dbPathArg: string | undefined

for (let i = 0; i < __argv.length; i++) {
  if (__argv[i] === '--db-path' && __argv[i + 1]) {
    __dbPathArg = __argv[++i]
  }
}

// ---------------------------------------------------------------------------
// Stdout capture — the MCP stdio protocol owns stdout exclusively.
// ---------------------------------------------------------------------------
import { Writable } from 'node:stream'

const realWrite = process.stdout.write.bind(process.stdout)
const mcpStdout = new Writable({
  write(chunk, encoding, callback): void {
    realWrite(chunk, encoding as BufferEncoding, callback)
  },
})
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
import { setLogger } from '@main/utils/logger'

const noop = (): void => {}
setLogger({ debug: noop, info: noop })

import { MemoryLaneMCPServer } from '@main/mcp/server'
import { getDefaultDbPath } from '@main/utils/paths'
import { resolveDbPath } from './config'
import { isNativeBindingError, formatNativeBindingHint } from './native-error'

// ---------------------------------------------------------------------------
// Stdio mode
// ---------------------------------------------------------------------------
async function mainStdio(): Promise<void> {
  const { dbPath } = resolveDbPath(__dbPathArg, getDefaultDbPath)
  const server = new MemoryLaneMCPServer()
  await server.start(dbPath, mcpStdout)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
mainStdio().catch((error) => {
  if (isNativeBindingError(error)) {
    process.stderr.write(formatNativeBindingHint(error))
    process.exit(1)
  }
  console.error('Fatal error:', error)
  process.exit(1)
})
