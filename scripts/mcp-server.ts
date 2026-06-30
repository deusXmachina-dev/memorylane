#!/usr/bin/env npx tsx
/**
 * Standalone MCP server entry point.
 *
 * This script starts the MemoryLane MCP server with stdio transport,
 * suitable for testing and integration with MCP clients like Claude Desktop.
 *
 * Usage:
 *   npm run mcp:start
 *
 * Or test with MCP Inspector:
 *   npx @modelcontextprotocol/inspector npm run mcp:start
 */

// Capture the real stdout IMMEDIATELY and redirect process.stdout to stderr.
// The MCP stdio protocol owns stdout exclusively — this prevents ANY module
// (dotenv, native addons, etc.) from polluting the transport channel.
import { Writable } from 'node:stream'

const realWrite = process.stdout.write.bind(process.stdout)
const mcpStdout = new Writable({
  write(chunk, encoding, callback): void {
    realWrite(chunk, encoding as BufferEncoding, callback)
  },
})
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write

async function main() {
  const [{ MemoryLaneMCPServer }, { getDefaultDbPath }] = await Promise.all([
    import('../src/main/mcp/server'),
    import('../src/main/utils/paths'),
  ])
  const server = new MemoryLaneMCPServer()
  await server.start(getDefaultDbPath(), mcpStdout)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
