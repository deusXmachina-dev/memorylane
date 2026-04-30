import type {
  ProviderConfigInput,
  ProviderConfigPatch,
  ProviderKind,
  ProviderSource,
  ProviderStatus,
  ProvidersSnapshot,
} from '../../shared/types'

export type {
  ProviderKind,
  ProviderSource,
  ProviderConfigInput,
  ProviderConfigPatch,
  ProviderStatus,
  ProvidersSnapshot,
}

export const PROVIDER_KINDS: ProviderKind[] = [
  'openrouter',
  'openai',
  'anthropic',
  'openai-compatible',
]

export interface ProviderConfig {
  id: string
  kind: ProviderKind
  name: string
  baseURL?: string
  defaultModel?: string
  source: ProviderSource
  createdAt: number
}
