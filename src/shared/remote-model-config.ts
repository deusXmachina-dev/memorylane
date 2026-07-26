export const REMOTE_MODEL_SLOTS = [
  'semanticVideo',
  'semanticSnapshot',
  'taskMining',
  'userContext',
  'clusterReview',
] as const

export type RemoteModelSlot = (typeof REMOTE_MODEL_SLOTS)[number]

/**
 * Backend-published model pipeline config (`GET api/config/models`). Managed
 * installs take their model chains strictly and exclusively from here — the
 * backend is responsible for serving ids valid for the provider it assigned.
 * BYOK and custom endpoints keep full model control and never consult it.
 */
export interface RemoteModelConfig {
  /** Config revision; informational only — the latest fetched config always applies. */
  version: number
  /** Ordered fallback chains of model ids. Empty/missing slot → baked VENDOR_PRESETS. */
  models: Partial<Record<RemoteModelSlot, string[]>>
}
