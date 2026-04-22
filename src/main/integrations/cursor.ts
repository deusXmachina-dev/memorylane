/**
 * Cursor IDE MCP integration
 *
 * Reads and updates Cursor's MCP config to register MemoryLane
 * as an MCP server, so users can enable the integration with one click.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import log from '../logger'
import { buildAppMcpEntry, getMcpEntryScriptPath } from './app-mcp-entry'
import {
  detectLegacyAppSignal,
  detectLegacyNpxSignal,
  extractDbPathArg,
  isCurrentAppEntry,
} from './migration-utils'
import { app } from 'electron'
import type { McpEntryStatus } from '../../shared/types'

interface CursorMCPConfig {
  mcpServers?: Record<string, MCPServerEntry>
  [key: string]: unknown
}

interface MCPServerEntry {
  command: string
  args?: string[]
  env?: Record<string, string>
  [key: string]: unknown
}

const MCP_SERVER_KEY = 'memorylane'

/**
 * Returns the path to Cursor's global MCP config file (~/.cursor/mcp.json).
 */
function getCursorConfigPath(): string {
  return path.join(os.homedir(), '.cursor', 'mcp.json')
}

/**
 * Read and parse the Cursor MCP config.
 * Returns an empty config object if the file doesn't exist or is invalid.
 */
function readCursorConfig(configPath: string): CursorMCPConfig {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as CursorMCPConfig
    }
    return {}
  } catch {
    return {}
  }
}

/**
 * Write the config back to disk, creating the parent directory if needed.
 */
function writeCursorConfig(configPath: string, config: CursorMCPConfig): void {
  const dir = path.dirname(configPath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/**
 * Check whether MemoryLane is already registered in the Cursor MCP config.
 */
function isRegistered(config: CursorMCPConfig): boolean {
  return config.mcpServers !== undefined && MCP_SERVER_KEY in config.mcpServers
}

/**
 * Build the MCP server entry pointing at the current Electron app,
 * preserving any user-added `--db-path` from a prior entry.
 */
function buildMCPEntry(preservedDbPath?: string): MCPServerEntry {
  const base = buildAppMcpEntry()
  const args = preservedDbPath ? [...base.args, '--db-path', preservedDbPath] : base.args
  return { command: base.command, args, env: base.env }
}

/**
 * Report whether MemoryLane is registered in Cursor's MCP config, and whether
 * the entry matches the current app. See getClaudeDesktopStatus for the
 * three-state semantics and the conservative stance on foreign entries.
 */
export function getCursorStatus(): McpEntryStatus {
  const config = readCursorConfig(getCursorConfigPath())
  const existing = config.mcpServers?.[MCP_SERVER_KEY]
  if (!existing) return 'not-registered'

  const currentExe = app.getPath('exe')
  const currentScript = getMcpEntryScriptPath()
  if (isCurrentAppEntry(existing, currentExe, currentScript)) return 'current'

  const signal = detectLegacyNpxSignal(existing) ?? detectLegacyAppSignal(existing)
  return signal !== null ? 'stale' : 'current'
}

export async function registerWithCursor(): Promise<boolean> {
  const configPath = getCursorConfigPath()
  log.info(`[Cursor Integration] Config path: ${configPath}`)

  try {
    const config = readCursorConfig(configPath)

    const alreadyRegistered = isRegistered(config)
    const preservedDbPath = alreadyRegistered
      ? extractDbPathArg(config.mcpServers?.[MCP_SERVER_KEY]?.args)
      : undefined

    if (config.mcpServers === undefined) {
      config.mcpServers = {}
    }
    config.mcpServers[MCP_SERVER_KEY] = buildMCPEntry(preservedDbPath)

    writeCursorConfig(configPath, config)

    log.info(`[Cursor Integration] ${alreadyRegistered ? 'Updated' : 'Registered'} successfully`)
    return true
  } catch (error) {
    log.error('[Cursor Integration] Registration failed:', error)
    return false
  }
}
