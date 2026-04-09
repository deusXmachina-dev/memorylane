/**
 * Claude Desktop MCP integration
 *
 * Reads and updates Claude Desktop's config to register MemoryLane
 * as an MCP server, so users can enable the integration with one click.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import log from '../logger'
import { detectStaleSignal, isCurrentCliEntry } from './migration-utils'

interface ClaudeDesktopConfig {
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
 * Returns the platform-specific path to Claude Desktop's config file.
 */
function getClaudeConfigPath(): string {
  switch (process.platform) {
    case 'darwin':
      return path.join(
        os.homedir(),
        'Library',
        'Application Support',
        'Claude',
        'claude_desktop_config.json',
      )
    case 'win32':
      return path.join(
        process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
        'Claude',
        'claude_desktop_config.json',
      )
    default:
      return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json')
  }
}

/**
 * Read and parse the Claude Desktop config.
 * Returns an empty config object if the file doesn't exist or is invalid.
 */
function readClaudeConfig(configPath: string): ClaudeDesktopConfig {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as ClaudeDesktopConfig
    }
    return {}
  } catch {
    return {}
  }
}

/**
 * Write the config back to disk, creating the parent directory if needed.
 */
function writeClaudeConfig(configPath: string, config: ClaudeDesktopConfig): void {
  const dir = path.dirname(configPath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/**
 * Check whether MemoryLane is already registered in the Claude Desktop config.
 */
function isRegistered(config: ClaudeDesktopConfig): boolean {
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
 * Check whether MemoryLane is currently registered in Claude Desktop's config on disk.
 */
export function isMcpAddedToClaudeDesktop(): boolean {
  const config = readClaudeConfig(getClaudeConfigPath())
  return isRegistered(config)
}

/**
 * If a stale (pre-v0.18) MemoryLane MCP entry exists, replace it with the CLI entry.
 * Best-effort: never throws — Claude Desktop config may be missing, malformed,
 * or unwritable, and none of those should block app startup.
 */
export function migrateClaudeDesktop(): void {
  const configPath = getClaudeConfigPath()
  try {
    if (!fs.existsSync(configPath)) {
      log.debug(`[Claude Integration] No config at ${configPath}, skipping migration`)
      return
    }
    const config = readClaudeConfig(configPath)
    const existing = config.mcpServers?.[MCP_SERVER_KEY]
    if (!existing) {
      log.debug('[Claude Integration] No memorylane entry present, nothing to migrate')
      return
    }
    if (isCurrentCliEntry(existing)) {
      log.debug('[Claude Integration] memorylane entry already current, nothing to migrate')
      return
    }
    const signal = detectStaleSignal(existing)
    if (!signal) {
      log.info(
        '[Claude Integration] memorylane entry present but does not match a known stale shape, leaving it alone',
      )
      return
    }

    config.mcpServers![MCP_SERVER_KEY] = buildMCPEntry()
    writeClaudeConfig(configPath, config)
    log.info(`[Claude Integration] Migrated from Electron MCP to CLI (signal: ${signal})`)
  } catch (error) {
    log.warn('[Claude Integration] Migration failed:', error)
  }
}

export async function registerWithClaudeDesktop(): Promise<boolean> {
  const configPath = getClaudeConfigPath()
  log.info(`[Claude Integration] Config path: ${configPath}`)

  try {
    const config = readClaudeConfig(configPath)

    const alreadyRegistered = isRegistered(config)

    if (config.mcpServers === undefined) {
      config.mcpServers = {}
    }
    config.mcpServers[MCP_SERVER_KEY] = buildMCPEntry()

    writeClaudeConfig(configPath, config)

    log.info(`[Claude Integration] ${alreadyRegistered ? 'Updated' : 'Registered'} successfully`)
    return true
  } catch (error) {
    log.error('[Claude Integration] Registration failed:', error)
    return false
  }
}
