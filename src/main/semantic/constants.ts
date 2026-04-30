import type { ProviderKind } from '../../shared/types'

export const LLM_IMAGE_MAX_WIDTH = 1920

export const DEFAULT_MODELS_BY_KIND: Record<
  ProviderKind,
  { video: readonly string[]; snapshot: readonly string[] }
> = {
  openrouter: {
    video: [
      'google/gemini-2.5-flash-lite-preview-09-2025',
      'google/gemini-3-flash-preview',
      'allenai/molmo-2-8b',
    ],
    snapshot: ['mistralai/mistral-small-3.2-24b-instruct', 'google/gemini-2.5-flash-lite'],
  },
  openai: {
    video: [],
    snapshot: ['gpt-4o-mini', 'gpt-4o'],
  },
  anthropic: {
    video: [],
    snapshot: ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest'],
  },
  google: {
    video: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    snapshot: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'],
  },
  'openai-compatible': {
    video: [],
    snapshot: [],
  },
}

export function getDefaultModelsForKind(kind: ProviderKind): {
  video: readonly string[]
  snapshot: readonly string[]
} {
  return DEFAULT_MODELS_BY_KIND[kind]
}

// Back-compat aliases — prefer getDefaultModelsForKind in new code.
export const DEFAULT_VIDEO_MODELS = DEFAULT_MODELS_BY_KIND.openrouter.video
export const DEFAULT_SNAPSHOT_MODELS = DEFAULT_MODELS_BY_KIND.openrouter.snapshot

export const MODEL_PRICING_USD_PER_MILLION: Record<
  string,
  { input_tokens_per_million: number; completion_tokens_per_million: number }
> = {
  'google/gemini-2.5-flash-lite-preview-09-2025': {
    input_tokens_per_million: 0.1,
    completion_tokens_per_million: 0.4,
  },
  'google/gemini-3-flash-preview': {
    input_tokens_per_million: 0.5,
    completion_tokens_per_million: 3,
  },
  'allenai/molmo-2-8b': {
    input_tokens_per_million: 0.2,
    completion_tokens_per_million: 0.2,
  },
  'mistralai/mistral-small-3.2-24b-instruct': {
    input_tokens_per_million: 0.08,
    completion_tokens_per_million: 0.2,
  },
  'google/gemini-2.5-flash-lite': {
    input_tokens_per_million: 0.1,
    completion_tokens_per_million: 0.4,
  },
}
