import * as path from 'path'
import * as os from 'os'

const DEV_ELECTRON_EXECUTABLE_NAMES = new Set(['electron', 'electron.exe'])
const APP_DIRECTORY_NAME = 'MemoryLane'
const DEV_APP_DIRECTORY_SUFFIX = '-dev'

/**
 * Gets the default path for the SQLite database file.
 * Pure Node.js resolution — mimics Electron's default userData paths
 * without importing Electron. Used by CLI tools, MCP server, and other
 * non-Electron entry points. The main Electron process should use
 * app.getPath('userData') directly instead.
 */
export function getDefaultDbPath(): string {
  const dev = isDevRuntime()
  return buildFallbackDbPath(process.platform, os.homedir(), process.env.APPDATA, dev)
}

export function isDevRuntime(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  if (process.versions.electron) return !isPackagedElectronExecutable(process.execPath)
  return true
}

export function getAppDirectoryName(dev: boolean): string {
  return dev ? `${APP_DIRECTORY_NAME}${DEV_APP_DIRECTORY_SUFFIX}` : APP_DIRECTORY_NAME
}

export function isPackagedElectronExecutable(execPath: string): boolean {
  const executableName = execPath.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  return !DEV_ELECTRON_EXECUTABLE_NAMES.has(executableName)
}

export function buildFallbackDbPath(
  platform: NodeJS.Platform,
  homeDir: string,
  appDataDir: string | undefined,
  dev: boolean,
): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const appDirectory = getAppDirectoryName(dev)
  const dbFile = dev ? 'memorylane-dev.db' : 'memorylane.db'

  if (platform === 'darwin') {
    return pathApi.join(homeDir, 'Library', 'Application Support', appDirectory, dbFile)
  }
  if (platform === 'win32') {
    return pathApi.join(appDataDir || '', appDirectory, dbFile)
  }
  return pathApi.join(homeDir, '.config', appDirectory, dbFile)
}
