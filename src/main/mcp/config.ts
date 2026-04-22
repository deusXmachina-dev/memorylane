/**
 * DB-path config consumed ONLY by MCP surfaces (the CLI bin and the
 * Electron mcp-entry). The Electron main process (recorder) MUST route
 * its database to `getDefaultDbPath()` in `src/main/paths.ts` — not
 * through this module. set_db_path must never affect recording.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const CONFIG_DIR = path.join(os.homedir(), '.config', 'memorylane')
const CONFIG_FILE = path.join(CONFIG_DIR, 'cli.json')

interface CliConfig {
  dbPath?: string
}

function readConfig(): CliConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function writeConfig(config: CliConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n')
}

export function setDbPath(dbPath: string): void {
  const config = readConfig()
  config.dbPath = dbPath
  writeConfig(config)
}

/**
 * Clear the persisted DB path so future resolution falls back to
 * MEMORYLANE_DB_PATH / default.
 */
export function clearDbPath(): void {
  const config = readConfig()
  delete config.dbPath
  writeConfig(config)
}

export function getConfigDbPath(): string | undefined {
  return readConfig().dbPath
}

export function getConfigFilePath(): string {
  return CONFIG_FILE
}

/**
 * Resolves the DB path with this priority:
 * 1. Explicit flag (--db-path)
 * 2. MEMORYLANE_DB_PATH env var
 * 3. ~/.config/memorylane/cli.json → dbPath
 * 4. getDefault() fallback
 *
 * Returns the resolved path and where it came from.
 */
export function resolveDbPath(
  flagValue: string | undefined,
  getDefault: () => string,
): { dbPath: string; source: string } {
  if (flagValue) {
    return { dbPath: flagValue, source: 'flag' }
  }

  const envPath = process.env.MEMORYLANE_DB_PATH
  if (envPath) {
    return { dbPath: envPath, source: 'env' }
  }

  const configPath = getConfigDbPath()
  if (configPath) {
    return { dbPath: configPath, source: 'config' }
  }

  return { dbPath: getDefault(), source: 'default' }
}
