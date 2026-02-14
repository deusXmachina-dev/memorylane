#!/usr/bin/env npx tsx
/**
 * Toggle Claude Desktop's MCP config between the installed MemoryLane app
 * and the local dev source.
 *
 * Usage:
 *   npm run mcp:dev            # switch to dev
 *   npm run mcp:dev:off        # switch back to installed app
 *   npm run mcp:dev:status     # show current mode
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MEMORYLANE_SERVER_NAME = 'memorylane'
const DEV_MODE_ENV_KEY = 'MEMORYLANE_MCP_MODE'
const DEV_MODE_ENV_VALUE = 'dev'

interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

interface ClaudeConfig {
  mcpServers?: Record<string, unknown>
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseStringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) {
    return null
  }

  const parsed: Record<string, string> = {}
  for (const [key, entryValue] of Object.entries(value)) {
    if (typeof entryValue !== 'string') {
      return null
    }
    parsed[key] = entryValue
  }

  return parsed
}

function getClaudeDesktopConfigPath(): string {
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    )
  }

  if (process.platform === 'win32') {
    const appDataDir = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appDataDir, 'Claude', 'claude_desktop_config.json')
  }

  return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json')
}

function getDevElectronBinaryPath(): string {
  if (process.platform === 'darwin') {
    return path.join(
      PROJECT_ROOT,
      'node_modules',
      'electron',
      'dist',
      'Electron.app',
      'Contents',
      'MacOS',
      'Electron',
    )
  }

  if (process.platform === 'win32') {
    return path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  }

  return path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', 'electron')
}

function getProdInstallPaths(): { command: string; mcpEntrypoint: string } {
  if (process.platform === 'darwin') {
    const appContentsDir = path.join('/Applications', 'MemoryLane.app', 'Contents')
    return {
      command: path.join(appContentsDir, 'MacOS', 'MemoryLane'),
      mcpEntrypoint: path.join(appContentsDir, 'Resources', 'app.asar', 'out', 'main', 'mcp-entry.js'),
    }
  }

  if (process.platform === 'win32') {
    const localAppDataDir = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local')
    const installDir = path.join(localAppDataDir, 'Programs', 'MemoryLane')
    return {
      command: path.join(installDir, 'MemoryLane.exe'),
      mcpEntrypoint: path.join(installDir, 'resources', 'app.asar', 'out', 'main', 'mcp-entry.js'),
    }
  }

  throw new Error(`Installed-app MCP mode is unsupported on platform "${process.platform}"`)
}

function buildProdConfig(): McpServerConfig {
  const installPaths = getProdInstallPaths()
  return {
    command: installPaths.command,
    args: [installPaths.mcpEntrypoint],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
}

function buildDevConfig(): McpServerConfig {
  const tsxCliPath = path.join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const mcpServerScriptPath = path.join(PROJECT_ROOT, 'scripts', 'mcp-server.ts')

  return {
    command: getDevElectronBinaryPath(),
    args: [tsxCliPath, mcpServerScriptPath],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      [DEV_MODE_ENV_KEY]: DEV_MODE_ENV_VALUE,
    },
  }
}

function readConfig(configPath: string): ClaudeConfig {
  if (!fs.existsSync(configPath)) {
    console.error(`Claude Desktop config not found at:\n  ${configPath}`)
    process.exit(1)
  }

  const parsedConfig: unknown = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  if (!isRecord(parsedConfig)) {
    console.error(`Invalid Claude Desktop config format at:\n  ${configPath}`)
    process.exit(1)
  }

  return parsedConfig
}

function writeConfig(configPath: string, config: ClaudeConfig): void {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
}

function getMemoryLaneServerConfig(config: ClaudeConfig): McpServerConfig | null {
  const memorylaneServer = config.mcpServers?.[MEMORYLANE_SERVER_NAME]
  if (!isRecord(memorylaneServer)) {
    return null
  }

  const command = memorylaneServer.command
  if (typeof command !== 'string') {
    return null
  }

  const parsedConfig: McpServerConfig = { command }
  const args = memorylaneServer.args
  if (Array.isArray(args) && args.every((arg) => typeof arg === 'string')) {
    parsedConfig.args = args
  }

  const env = parseStringRecord(memorylaneServer.env)
  if (env) {
    parsedConfig.env = env
  }

  return parsedConfig
}

function isDev(config: ClaudeConfig): boolean {
  const memorylaneServer = getMemoryLaneServerConfig(config)
  if (!memorylaneServer) {
    return false
  }

  if (memorylaneServer.env?.[DEV_MODE_ENV_KEY] === DEV_MODE_ENV_VALUE) {
    return true
  }

  return memorylaneServer.command === getDevElectronBinaryPath()
}

function ensureMcpServers(config: ClaudeConfig): Record<string, unknown> {
  const currentServers = config.mcpServers
  if (isRecord(currentServers)) {
    return currentServers
  }

  config.mcpServers = {}
  return config.mcpServers
}

function status(config: ClaudeConfig): void {
  const memorylaneServer = getMemoryLaneServerConfig(config)
  if (!memorylaneServer) {
    console.log('memorylane MCP server is not configured in Claude Desktop')
    return
  }

  const mode = isDev(config) ? 'dev' : 'installed app'
  console.log(`memorylane MCP → ${mode}`)
  console.log(`  command: ${memorylaneServer.command}`)
  if (memorylaneServer.args && memorylaneServer.args.length > 0) {
    console.log(`  args: ${memorylaneServer.args.join(' ')}`)
  }
}

const action = process.argv[2] ?? 'on'
if (action !== 'on' && action !== 'off' && action !== 'status') {
  console.error(`Unknown action "${action}". Use one of: on, off, status.`)
  process.exit(1)
}

const configPath = getClaudeDesktopConfigPath()
const config = readConfig(configPath)

if (action === 'status') {
  status(config)
  process.exit(0)
}

const mcpServers = ensureMcpServers(config)
if (action === 'off') {
  mcpServers[MEMORYLANE_SERVER_NAME] = buildProdConfig()
  writeConfig(configPath, config)
  console.log('Switched memorylane MCP → installed app')
  console.log('Restart Claude Desktop to apply.')
} else {
  mcpServers[MEMORYLANE_SERVER_NAME] = buildDevConfig()
  writeConfig(configPath, config)
  console.log('Switched memorylane MCP → dev')
  console.log(`  source: ${PROJECT_ROOT}`)
  console.log('Restart Claude Desktop to apply.')
}
