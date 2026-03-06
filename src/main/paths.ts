import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const DEV_ELECTRON_EXECUTABLE_NAMES = new Set(['electron', 'electron.exe'])
const APP_DIRECTORY_NAME = 'MemoryLane'
const DEV_APP_DIRECTORY_SUFFIX = '-dev'

/**
 * Returns the base app data directory.
 * Pure Node.js resolution — mimics Electron's default userData paths
 * without importing Electron. Used by CLI tools, MCP server, and other
 * non-Electron entry points. The main Electron process should use
 * app.getPath('userData') directly instead.
 */
export function getAppDataPath(): string {
  const dev = isDevRuntime()
  return buildAppDataPath(process.platform, os.homedir(), process.env.APPDATA, dev)
}

export function getDefaultDbPath(): string {
  const dev = isDevRuntime()
  const dbFile = dev ? 'memorylane-dev.db' : 'memorylane.db'
  return path.join(getAppDataPath(), dbFile)
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

export function buildAppDataPath(
  platform: NodeJS.Platform,
  homeDir: string,
  appDataDir: string | undefined,
  dev: boolean,
): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const appDirectory = getAppDirectoryName(dev)

  if (platform === 'darwin') {
    return pathApi.join(homeDir, 'Library', 'Application Support', appDirectory)
  }
  if (platform === 'win32') {
    return pathApi.join(appDataDir || '', appDirectory)
  }
  return pathApi.join(homeDir, '.config', appDirectory)
}

export function getModelCacheDir(): string {
  return path.join(getAppDataPath(), 'models')
}

export function getBundledModelPath(): string | null {
  if (!process.versions.electron) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron')
    if (!app?.isPackaged) return null
  } catch {
    return null
  }
  const bundled = path.join(process.resourcesPath, 'models')
  return fs.existsSync(bundled) ? bundled : null
}
