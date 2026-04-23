/**
 * Claude Desktop MCP integration
 *
 * Reads and updates Claude Desktop's config to register MemoryLane
 * as an MCP server, so users can enable the integration with one click.
 *
 * Windows note: fresh MSIX-packaged Claude Desktop installs read their
 * config from a per-package virtualized sandbox under
 * `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\` instead of
 * the documented `%APPDATA%\Claude\`. We therefore discover every
 * `Claude_*` package present and dual-write, so the integration works on
 * both classic and MSIX installs. Upstream bug:
 * https://github.com/anthropics/claude-code/issues/26073
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
 * Returns every platform-specific path where Claude Desktop may read its
 * config file. On Windows this is the classic `%APPDATA%\Claude\...`
 * location plus every discovered MSIX package sandbox under
 * `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\...`. See the
 * module-level comment for the rationale.
 */
function getClaudeConfigPaths(): string[] {
  switch (process.platform) {
    case 'darwin':
      return [
        path.join(
          os.homedir(),
          'Library',
          'Application Support',
          'Claude',
          'claude_desktop_config.json',
        ),
      ]
    case 'win32': {
      const paths: string[] = []
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
      paths.push(path.join(appData, 'Claude', 'claude_desktop_config.json'))

      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
      const packagesDir = path.join(localAppData, 'Packages')
      try {
        for (const entry of fs.readdirSync(packagesDir)) {
          if (!entry.startsWith('Claude_')) continue
          paths.push(
            path.join(
              packagesDir,
              entry,
              'LocalCache',
              'Roaming',
              'Claude',
              'claude_desktop_config.json',
            ),
          )
        }
      } catch {
        // Packages dir missing or unreadable — only the classic path applies.
      }
      return paths
    }
    default:
      return [path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json')]
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
 * Build the MCP server entry pointing at the current Electron app,
 * preserving any user-added `--db-path` from a prior entry.
 */
function buildMCPEntry(preservedDbPath?: string): MCPServerEntry {
  const base = buildAppMcpEntry()
  const args = preservedDbPath ? [...base.args, '--db-path', preservedDbPath] : base.args
  return { command: base.command, args, env: base.env }
}

/**
 * Classify a single config file's memorylane entry, if any.
 */
function classifyConfigPath(
  configPath: string,
  currentExe: string,
  currentScript: string,
): McpEntryStatus {
  const config = readClaudeConfig(configPath)
  const existing = config.mcpServers?.[MCP_SERVER_KEY]
  if (!existing) return 'not-registered'
  if (isCurrentAppEntry(existing, currentExe, currentScript)) return 'current'
  const signal = detectLegacyNpxSignal(existing) ?? detectLegacyAppSignal(existing)
  return signal !== null ? 'stale' : 'current'
}

/**
 * Report whether MemoryLane is registered in Claude Desktop's config, and
 * whether the entry matches the current app. Surfaces three states so the UI
 * can prompt the user to reconnect instead of rewriting silently.
 *
 * Returns 'stale' only when the entry matches a legacy shape we're confident
 * we own (v0 Electron-as-node, v1 npx CLI, moved .app). A foreign entry under
 * the memorylane key reports 'current' — same conservative posture as before.
 *
 * On Windows we check every known config location (see `getClaudeConfigPaths`)
 * and reduce: any 'current' wins, else any 'stale' wins, else 'not-registered'.
 */
export function getClaudeDesktopStatus(): McpEntryStatus {
  const currentExe = app.getPath('exe')
  const currentScript = getMcpEntryScriptPath()

  let sawStale = false
  for (const configPath of getClaudeConfigPaths()) {
    const status = classifyConfigPath(configPath, currentExe, currentScript)
    if (status === 'current') return 'current'
    if (status === 'stale') sawStale = true
  }
  return sawStale ? 'stale' : 'not-registered'
}

export async function registerWithClaudeDesktop(): Promise<boolean> {
  const configPaths = getClaudeConfigPaths()
  log.info(`[Claude Integration] Config paths: ${configPaths.join(', ')}`)

  // First pass: read each config so we can preserve any user-added --db-path
  // regardless of which variant it currently lives in.
  const existingConfigs = configPaths.map((p) => ({ path: p, config: readClaudeConfig(p) }))
  let preservedDbPath: string | undefined
  for (const { config } of existingConfigs) {
    const dbPath = extractDbPathArg(config.mcpServers?.[MCP_SERVER_KEY]?.args)
    if (dbPath) {
      preservedDbPath = dbPath
      break
    }
  }

  const entry = buildMCPEntry(preservedDbPath)
  let anyWriteSucceeded = false
  for (const { path: configPath, config } of existingConfigs) {
    const alreadyRegistered = isRegistered(config)
    if (config.mcpServers === undefined) {
      config.mcpServers = {}
    }
    config.mcpServers[MCP_SERVER_KEY] = entry
    try {
      writeClaudeConfig(configPath, config)
      anyWriteSucceeded = true
      log.info(`[Claude Integration] ${alreadyRegistered ? 'Updated' : 'Registered'} ${configPath}`)
    } catch (error) {
      log.error(`[Claude Integration] Write failed for ${configPath}:`, error)
    }
  }

  if (!anyWriteSucceeded) {
    log.error('[Claude Integration] Registration failed: no config paths were writable')
  }
  return anyWriteSucceeded
}
