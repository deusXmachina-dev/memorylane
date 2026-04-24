import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_EDITION,
  parseEdition,
  type AppEdition,
  type AppEditionConfig,
} from '../shared/edition'
import { isPackagedElectronExecutable } from './paths'
import log from './logger'

type RawEditionConfig = Partial<AppEditionConfig>

interface LoadedEditionConfig {
  config: AppEditionConfig
  path: string
  source: 'dev' | 'packaged'
}

// Electron's `app` is only available when running as a real Electron app.
// Under ELECTRON_RUN_AS_NODE=1 (MCP entry) require('electron') throws, so
// we read it lazily and fall back to pure-Node detection.
function getElectronApp(): { isPackaged?: boolean; getAppPath?: () => string } | null {
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

function getDevEditionConfigPath(edition: AppEdition): string {
  const electronApp = getElectronApp()
  const appPath = electronApp?.getAppPath?.() ?? process.cwd()
  return path.join(appPath, 'config', 'editions', `${edition}.json`)
}

function getPackagedEditionConfigPath(): string {
  return path.join(process.resourcesPath, 'config', 'edition.json')
}

function loadAndValidateEditionConfig(
  configPath: string,
  requestedEdition?: AppEdition,
): AppEditionConfig {
  const rawConfig = fs.readFileSync(configPath, 'utf8')
  const parsed = JSON.parse(rawConfig) as RawEditionConfig

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Edition config must be a JSON object')
  }

  const edition = parseEdition(parsed.edition)
  if (parsed.edition !== edition) {
    throw new Error(`Invalid edition "${String(parsed.edition)}"`)
  }

  if (requestedEdition && edition !== requestedEdition) {
    throw new Error(
      `Edition config mismatch: requested "${requestedEdition}" but file contains "${edition}"`,
    )
  }

  return { edition }
}

function resolveEditionConfig(): LoadedEditionConfig {
  const electronApp = getElectronApp()
  const isPackaged = electronApp?.isPackaged ?? isPackagedElectronExecutable(process.execPath)

  if (!isPackaged) {
    const requestedEdition = parseEdition(process.env.EDITION)
    return {
      config: loadAndValidateEditionConfig(
        getDevEditionConfigPath(requestedEdition),
        requestedEdition,
      ),
      path: getDevEditionConfigPath(requestedEdition),
      source: 'dev',
    }
  }

  const configPath = getPackagedEditionConfigPath()
  return {
    config: loadAndValidateEditionConfig(configPath),
    path: configPath,
    source: 'packaged',
  }
}

export function loadAppEditionConfig(): AppEditionConfig {
  try {
    const loadedConfig = resolveEditionConfig()
    log.info(
      `[Edition] Loaded ${loadedConfig.config.edition} edition from ${loadedConfig.source} config at ${loadedConfig.path}`,
    )
    return loadedConfig.config
  } catch (error) {
    log.warn(`[Edition] Failed to load edition config, falling back to ${DEFAULT_EDITION}`, error)
    return { edition: DEFAULT_EDITION }
  }
}
