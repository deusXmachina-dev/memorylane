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
import { detectStaleSignal, isCurrentCliEntry } from './migration-utils'

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
 * Build the MCP server entry pointing to the CLI package.
 */
function buildMCPEntry(): MCPServerEntry {
  return {
    command: 'npx',
    args: ['-y', '-p', '@deusxmachina-dev/memorylane-cli', 'memorylane-mcp'],
  }
}

/**
 * Check whether MemoryLane is currently registered in Cursor's MCP config on disk.
 */
export function isMcpAddedToCursor(): boolean {
  const config = readCursorConfig(getCursorConfigPath())
  return isRegistered(config)
}

/**
 * If a stale (pre-v0.18) MemoryLane MCP entry exists, replace it with the CLI entry.
 * Best-effort: never throws — see migrateClaudeDesktop for rationale.
 */
export function migrateCursor(): void {
  const configPath = getCursorConfigPath()
  try {
    if (!fs.existsSync(configPath)) {
      log.debug(`[Cursor Integration] No config at ${configPath}, skipping migration`)
      return
    }
    const config = readCursorConfig(configPath)
    const existing = config.mcpServers?.[MCP_SERVER_KEY]
    if (!existing) {
      log.debug('[Cursor Integration] No memorylane entry present, nothing to migrate')
      return
    }
    if (isCurrentCliEntry(existing)) {
      log.debug('[Cursor Integration] memorylane entry already current, nothing to migrate')
      return
    }
    const signal = detectStaleSignal(existing)
    if (!signal) {
      log.info(
        '[Cursor Integration] memorylane entry present but does not match a known stale shape, leaving it alone',
      )
      return
    }

    config.mcpServers![MCP_SERVER_KEY] = buildMCPEntry()
    writeCursorConfig(configPath, config)
    log.info(`[Cursor Integration] Migrated from Electron MCP to CLI (signal: ${signal})`)
  } catch (error) {
    log.warn('[Cursor Integration] Migration failed:', error)
  }
}

export async function registerWithCursor(): Promise<boolean> {
  const configPath = getCursorConfigPath()
  log.info(`[Cursor Integration] Config path: ${configPath}`)

  try {
    const config = readCursorConfig(configPath)

    const alreadyRegistered = isRegistered(config)

    if (config.mcpServers === undefined) {
      config.mcpServers = {}
    }
    config.mcpServers[MCP_SERVER_KEY] = buildMCPEntry()

    writeCursorConfig(configPath, config)

    log.info(`[Cursor Integration] ${alreadyRegistered ? 'Updated' : 'Registered'} successfully`)
    return true
  } catch (error) {
    log.error('[Cursor Integration] Registration failed:', error)
    return false
  }
}
