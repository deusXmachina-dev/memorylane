/**
 * Claude Code MCP integration
 *
 * Reads and updates Claude Code's global settings to register MemoryLane
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

interface ClaudeCodeSettings {
  mcpServers?: Record<string, MCPServerEntry>
  [key: string]: unknown
}

interface MCPServerEntry {
  type?: string
  command: string
  args?: string[]
  env?: Record<string, string>
  [key: string]: unknown
}

const MCP_SERVER_KEY = 'memorylane'

/**
 * Returns the path to Claude Code's global settings file (~/.claude/settings.json).
 */
function getClaudeCodeSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json')
}

/**
 * Read and parse the Claude Code settings.
 * Returns an empty config object if the file doesn't exist or is invalid.
 */
function readSettings(settingsPath: string): ClaudeCodeSettings {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as ClaudeCodeSettings
    }
    return {}
  } catch {
    return {}
  }
}

/**
 * Write the settings back to disk, creating the parent directory if needed.
 */
function writeSettings(settingsPath: string, settings: ClaudeCodeSettings): void {
  const dir = path.dirname(settingsPath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
}

/**
 * Check whether MemoryLane is already registered in the Claude Code settings.
 */
function isRegistered(settings: ClaudeCodeSettings): boolean {
  return settings.mcpServers !== undefined && MCP_SERVER_KEY in settings.mcpServers
}

/**
 * Build the MCP server entry pointing at the current Electron app,
 * preserving any user-added `--db-path` from a prior entry.
 */
function buildMCPEntry(preservedDbPath?: string): MCPServerEntry {
  const base = buildAppMcpEntry()
  const args = preservedDbPath ? [...base.args, '--db-path', preservedDbPath] : base.args
  return { type: 'stdio', command: base.command, args, env: base.env }
}

/**
 * Check whether MemoryLane is currently registered in Claude Code's settings on disk.
 */
export function isMcpAddedToClaudeCode(): boolean {
  const settings = readSettings(getClaudeCodeSettingsPath())
  return isRegistered(settings)
}

/**
 * Migrate legacy MCP entries (npx CLI, or outdated app-as-node) to the current app entry.
 * Best-effort: never throws — see migrateClaudeDesktop for rationale.
 */
export function migrateClaudeCode(): void {
  const settingsPath = getClaudeCodeSettingsPath()
  try {
    if (!fs.existsSync(settingsPath)) {
      log.debug(`[Claude Code Integration] No settings at ${settingsPath}, skipping migration`)
      return
    }
    const settings = readSettings(settingsPath)
    const existing = settings.mcpServers?.[MCP_SERVER_KEY]
    if (!existing) {
      log.debug('[Claude Code Integration] No memorylane entry present, nothing to migrate')
      return
    }
    const currentExe = app.getPath('exe')
    const currentScript = getMcpEntryScriptPath()
    if (isCurrentAppEntry(existing, currentExe, currentScript)) {
      log.debug('[Claude Code Integration] memorylane entry already current, nothing to migrate')
      return
    }
    const signal = detectLegacyNpxSignal(existing) ?? detectLegacyAppSignal(existing)
    if (!signal) {
      log.info(
        '[Claude Code Integration] memorylane entry present but does not match a known stale shape, leaving it alone',
      )
      return
    }

    const preservedDbPath = extractDbPathArg(existing.args)
    settings.mcpServers![MCP_SERVER_KEY] = buildMCPEntry(preservedDbPath)
    writeSettings(settingsPath, settings)
    log.info(`[Claude Code Integration] Migrated to app entry (signal: ${signal})`)
  } catch (error) {
    log.warn('[Claude Code Integration] Migration failed:', error)
  }
}

export async function registerWithClaudeCode(): Promise<boolean> {
  const settingsPath = getClaudeCodeSettingsPath()
  log.info(`[Claude Code Integration] Settings path: ${settingsPath}`)

  try {
    const settings = readSettings(settingsPath)

    const alreadyRegistered = isRegistered(settings)
    const preservedDbPath = alreadyRegistered
      ? extractDbPathArg(settings.mcpServers?.[MCP_SERVER_KEY]?.args)
      : undefined

    if (settings.mcpServers === undefined) {
      settings.mcpServers = {}
    }
    settings.mcpServers[MCP_SERVER_KEY] = buildMCPEntry(preservedDbPath)

    writeSettings(settingsPath, settings)

    log.info(
      `[Claude Code Integration] ${alreadyRegistered ? 'Updated' : 'Registered'} successfully`,
    )
    return true
  } catch (error) {
    log.error('[Claude Code Integration] Registration failed:', error)
    return false
  }
}
