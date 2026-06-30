import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type { AppEdition } from '@/shared/edition'

const DEV_ELECTRON_EXECUTABLE_NAMES = new Set(['electron', 'electron.exe'])
const APP_DIRECTORY_NAME = 'MemoryLane'
const ENTERPRISE_DIRECTORY_SUFFIX = ' Enterprise'
const DEV_APP_DIRECTORY_SUFFIX = '-dev'

/**
 * Returns the base app data directory.
 * Pure Node.js resolution — mimics Electron's default userData paths
 * without importing Electron. Used by CLI tools, MCP server, and other
 * non-Electron entry points. The main Electron process should use
 * app.getPath('userData') directly instead.
 *
 * The enterprise edition uses a distinct directory name (`MemoryLane Enterprise`)
 * that matches `productName` in electron-builder.config.js, so the resulting path
 * aligns with Electron's userData directory for the enterprise build.
 */
export function getAppDataPath(edition: AppEdition = 'customer'): string {
  const dev = isDevRuntime()
  return buildAppDataPath(process.platform, os.homedir(), process.env.APPDATA, dev, edition)
}

export function getDefaultDbPath(edition: AppEdition = 'customer'): string {
  const dev = isDevRuntime()
  const dbFile = dev ? 'memorylane-dev.db' : 'memorylane.db'
  return path.join(getAppDataPath(edition), dbFile)
}

export function isDevRuntime(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  if (process.versions.electron) return !isPackagedElectronExecutable(process.execPath)
  // Non-Electron (CLI): only dev if explicitly set
  return process.env.NODE_ENV === 'development'
}

export function getAppDirectoryName(dev: boolean, edition: AppEdition = 'customer'): string {
  const editionPart = edition === 'enterprise' ? ENTERPRISE_DIRECTORY_SUFFIX : ''
  const devPart = dev ? DEV_APP_DIRECTORY_SUFFIX : ''
  return `${APP_DIRECTORY_NAME}${editionPart}${devPart}`
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
  edition: AppEdition = 'customer',
): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const appDirectory = getAppDirectoryName(dev, edition)

  if (platform === 'darwin') {
    return pathApi.join(homeDir, 'Library', 'Application Support', appDirectory)
  }
  if (platform === 'win32') {
    return pathApi.join(appDataDir || '', appDirectory)
  }
  return pathApi.join(homeDir, '.config', appDirectory)
}

// Intentionally edition-agnostic: embedding model weights are identical across
// editions, so both customer and enterprise installs share the same cache dir
// (`MemoryLane/models`). This avoids duplicate ~100 MB downloads when a machine
// runs both builds. If an edition-specific model is ever bundled, thread an
// AppEdition param here and through EmbeddingService.
export function getModelCacheDir(): string {
  return path.join(getAppDataPath(), 'models')
}

/**
 * Returns Electron's `app` object if available, otherwise null.
 *
 * Lazy `require('electron')` inside try/catch so this is safe to call from
 * code paths that may run under `ELECTRON_RUN_AS_NODE=1` (e.g. the MCP entry),
 * where the `electron` module is unresolvable. A top-level
 * `import { app } from 'electron'` would crash the MCP process at module init,
 * before `main()` runs — see `mcp-entry-isolation.test.ts`.
 */
export function getElectronAppOrNull(): {
  isPackaged?: boolean
  getAppPath?: () => string
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron')
    if (typeof electron === 'object' && electron !== null && 'app' in electron) {
      return (electron as { app: { isPackaged?: boolean; getAppPath?: () => string } }).app
    }
  } catch {
    // ELECTRON_RUN_AS_NODE — electron module unavailable
  }
  return null
}

export function getBundledModelPath(): string | null {
  if (!process.versions.electron) return null

  const app = getElectronAppOrNull()
  const isPackaged =
    typeof app?.isPackaged === 'boolean'
      ? app.isPackaged
      : isPackagedElectronExecutable(process.execPath)
  if (!isPackaged) return null

  const bundled = path.join(process.resourcesPath, 'models')
  return fs.existsSync(bundled) ? bundled : null
}
