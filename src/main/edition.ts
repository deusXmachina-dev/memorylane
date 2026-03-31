import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_EDITION,
  parseEdition,
  type AppEdition,
  type AppEditionConfig,
} from '../shared/edition'
import log from './logger'

type RawEditionConfig = Partial<AppEditionConfig>

interface LoadedEditionConfig {
  config: AppEditionConfig
  path: string
  source: 'dev' | 'packaged'
}

function getDevEditionConfigPath(edition: AppEdition): string {
  return path.join(app.getAppPath(), 'config', 'editions', `${edition}.json`)
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
  if (!app.isPackaged) {
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
