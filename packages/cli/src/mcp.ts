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
import { setLogger } from '@main/logger'

const noop = (): void => {}
setLogger({ debug: noop, info: noop })

import * as fs from 'fs'
import { z } from 'zod'
import { MemoryLaneMCPServer } from '@main/mcp/server'
import { getDefaultDbPath } from '@main/paths'
import { resolveDbPath, setDbPath } from './config'

// ---------------------------------------------------------------------------
// Stdio mode
// ---------------------------------------------------------------------------
async function mainStdio(): Promise<void> {
  const { dbPath } = resolveDbPath(__dbPathArg, getDefaultDbPath)

  const server = new MemoryLaneMCPServer()

  // Register CLI-only set_db_path tool
  server.getServer().registerTool(
    'set_db_path',
    {
      title: 'Set Database Path',
      description:
        'Set the database path for the MCP server. Persists the path to config and reinitializes the connection.',
      inputSchema: {
        dbPath: z.string().describe('Absolute path to the MemoryLane .db file'),
      },
    },
    async ({ dbPath: newDbPath }) => {
      if (!fs.existsSync(newDbPath)) {
        return {
          content: [
            { type: 'text' as const, text: `Error: database file not found at: ${newDbPath}` },
          ],
          isError: true,
        }
      }

      setDbPath(newDbPath)
      await server.reinitializeWithDb(newDbPath)

      return {
        content: [
          {
            type: 'text' as const,
            text: `Database path updated to: ${newDbPath}`,
          },
        ],
      }
    },
  )

  await server.start(dbPath, mcpStdout)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
mainStdio().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
