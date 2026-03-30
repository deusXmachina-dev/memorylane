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

function isOldElectronEntry(entry: MCPServerEntry): boolean {
  return entry.env?.ELECTRON_RUN_AS_NODE === '1'
}

/**
 * Check whether MemoryLane is currently registered in Claude Desktop's config on disk.
 */
export function isMcpAddedToClaudeDesktop(): boolean {
  const config = readClaudeConfig(getClaudeConfigPath())
  return isRegistered(config)
}

/**
 * If the old Electron-based MCP entry exists, replace it with the CLI entry.
 */
export function migrateClaudeDesktop(): void {
  const configPath = getClaudeConfigPath()
  try {
    const config = readClaudeConfig(configPath)
    const existing = config.mcpServers?.[MCP_SERVER_KEY]
    if (!existing || !isOldElectronEntry(existing)) return

    config.mcpServers![MCP_SERVER_KEY] = buildMCPEntry()
    writeClaudeConfig(configPath, config)
    log.info('[Claude Integration] Migrated from Electron MCP to CLI')
  } catch {
    // best-effort
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
