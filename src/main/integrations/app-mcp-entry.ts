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
 * In production this lives inside the asar; when unpacked is required (for
 * native .node addons) electron resolves those lazily, so the .js file itself
 * can stay packed.
 */
export function getMcpEntryScriptPath(): string {
  if (app.isPackaged) {
    return path.join(app.getAppPath(), 'out', 'main', 'mcp-entry.js')
  }
  // Dev: `electron-vite` outputs to the project root /out directory.
  return path.join(app.getAppPath(), 'out', 'main', 'mcp-entry.js')
}

export function buildAppMcpEntry(): AppMcpEntry {
  return {
    command: app.getPath('exe'),
    args: [getMcpEntryScriptPath()],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
}
