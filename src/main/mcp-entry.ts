/**
 * Standalone MCP server entry point.
 *
 * Runs under ELECTRON_RUN_AS_NODE=1 so macOS doesn't register it as a running
 * app instance — this allows the MCP server and the tray app to coexist.
 *
 * In production, MCP clients launch:
 *   ELECTRON_RUN_AS_NODE=1 /Applications/MemoryLane.app/.../MemoryLane <this file>
 *
 * The Electron binary is reused purely as a Node runtime so native modules
 * (better-sqlite3, onnxruntime-node, etc.) stay ABI-compatible.
 */

// Capture the real stdout IMMEDIATELY and redirect process.stdout to stderr.
// The MCP stdio protocol owns stdout exclusively — this prevents ANY module
// (dotenv, native addons, etc.) from polluting the transport channel.
import { Writable } from 'node:stream'
import * as os from 'os'

const realWrite = process.stdout.write.bind(process.stdout)
const mcpStdout = new Writable({
  write(chunk, encoding, callback): void {
    realWrite(chunk, encoding as BufferEncoding, callback)
  },
})
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write

import { config as loadEnv } from 'dotenv'
import * as path from 'path'
import { isPackagedElectronExecutable, buildAppDataPath } from './paths'

const isPackaged = isPackagedElectronExecutable(process.execPath)

try {
  if (!isPackaged) {
    loadEnv()
  }
} catch {
  // cwd might not be available in packaged app context
}

import { MemoryLaneMCPServer } from './mcp/server'

async function main(): Promise<void> {
  const dev = !isPackaged
  const appDataDir = buildAppDataPath(process.platform, os.homedir(), process.env.APPDATA, dev)
  const dbFile = dev ? 'memorylane-dev.db' : 'memorylane.db'
  const dbPath = path.join(appDataDir, dbFile)
  const server = new MemoryLaneMCPServer()
  await server.start(dbPath, mcpStdout)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
