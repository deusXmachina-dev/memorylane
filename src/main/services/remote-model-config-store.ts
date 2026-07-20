import * as fs from 'fs'
import * as path from 'path'
import log from '@main/utils/logger'
import {
  REMOTE_MODEL_SLOTS,
  type RemoteModelConfig,
  type RemoteModelSlot,
} from '../../shared/remote-model-config'

const FILE_NAME = 'remote-model-config.json'

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/
const MAX_MODEL_ID_LENGTH = 128
const MAX_CHAIN_LENGTH = 8

function coerceChain(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const chain: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const id = entry.trim()
    if (id.length === 0 || id.length > MAX_MODEL_ID_LENGTH) continue
    if (!MODEL_ID_PATTERN.test(id)) continue
    if (chain.includes(id)) continue
    chain.push(id)
    if (chain.length >= MAX_CHAIN_LENGTH) break
  }
  return chain
}

/**
 * Coerces an untrusted payload (network response or disk cache) into a
 * sanitized {@link RemoteModelConfig}, or null when the payload is unusable.
 * The single chokepoint for both inputs: a non-integer/negative version rejects
 * the whole payload; invalid chain entries are dropped, unknown keys ignored.
 */
export function coerceRemoteModelConfig(data: unknown): RemoteModelConfig | null {
  if (typeof data !== 'object' || data === null) return null
  const { version, models } = data as { version?: unknown; models?: unknown }
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) return null

  const result: Partial<Record<RemoteModelSlot, string[]>> = {}
  if (typeof models === 'object' && models !== null) {
    for (const slot of REMOTE_MODEL_SLOTS) {
      const chain = coerceChain((models as Record<string, unknown>)[slot])
      if (chain.length > 0) result[slot] = chain
    }
  }
  return { version, models: result }
}

function defaultPath(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron') as typeof import('electron')
  return path.join(electron.app.getPath('userData'), FILE_NAME)
}

/**
 * Reads the last-known remote model config cached on disk. Returns null when
 * the file is missing or unreadable/corrupt, so callers fall back to baked
 * presets until the first successful sync.
 */
export function readRemoteModelConfig(filePath: string = defaultPath()): RemoteModelConfig | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return coerceRemoteModelConfig(JSON.parse(raw))
  } catch {
    return null
  }
}

/**
 * Persists the latest remote model config. Failures are swallowed (logged) — a
 * disk hiccup must never break the sync loop.
 */
export function writeRemoteModelConfig(
  config: RemoteModelConfig,
  filePath: string = defaultPath(),
): void {
  try {
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2))
  } catch (error) {
    log.warn('[RemoteModelConfig] Failed to persist config:', error)
  }
}
