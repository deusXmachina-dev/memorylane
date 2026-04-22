/**
 * Build the MCP server entry that points at the MemoryLane Electron app
 * running under ELECTRON_RUN_AS_NODE=1. Used by all three integrations
 * (Claude Desktop, Claude Code, Cursor) so they never drift.
 */

import { app } from 'electron'
import * as path from 'node:path'

export interface AppMcpEntry {
  command: string
  args: string[]
  env: Record<string, string>
}

/**
 * Returns the path to the built mcp-entry.js script for the current runtime.
 * `app.getAppPath()` already resolves to the asar root in packaged builds and
 * to the project root in dev, so the same relative layout works for both.
 */
export function getMcpEntryScriptPath(): string {
  return path.join(app.getAppPath(), 'out', 'main', 'mcp-entry.js')
}

export function buildAppMcpEntry(): AppMcpEntry {
  return {
    command: app.getPath('exe'),
    args: [getMcpEntryScriptPath()],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
}
