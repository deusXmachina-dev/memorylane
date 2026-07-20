import { createUserDataJsonStore } from '@main/utils/json-file-store'
import {
  REMOTE_MODEL_SLOTS,
  type RemoteModelConfig,
  type RemoteModelSlot,
} from '../../shared/remote-model-config'

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

const store = createUserDataJsonStore(
  'remote-model-config.json',
  'RemoteModelConfig',
  coerceRemoteModelConfig,
)

export const readRemoteModelConfig = store.read
export const writeRemoteModelConfig = store.write
