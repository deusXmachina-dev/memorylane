import type { ProviderKind } from './provider'

export interface ProviderCapabilities {
  vision: boolean
  video: boolean
  toolUse: boolean
}

const CAPABILITIES: Record<ProviderKind, ProviderCapabilities> = {
  openrouter: { vision: true, video: true, toolUse: true },
  openai: { vision: true, video: false, toolUse: true },
  anthropic: { vision: true, video: false, toolUse: true },
  'openai-compatible': { vision: true, video: false, toolUse: true },
}

export function getCapabilities(kind: ProviderKind): ProviderCapabilities {
  return CAPABILITIES[kind]
}
