export const REMOTE_MODEL_SLOTS = [
  'semanticVideo',
  'semanticSnapshot',
  'taskMining',
  'userContext',
  'clusterReview',
] as const

export type RemoteModelSlot = (typeof REMOTE_MODEL_SLOTS)[number]

/**
 * Backend-published model pipeline config (`GET api/config/models`). One global
 * config; applies only to installs running a managed OpenRouter key — BYOK and
 * custom endpoints keep full model control.
 */
export interface RemoteModelConfig {
  /** Monotonic; 0 = no remote opinion. The backend bumps it on ANY change to `models`. */
  version: number
  /** Ordered fallback chains of OpenRouter model ids. Empty/missing slot → baked VENDOR_PRESETS. */
  models: Partial<Record<RemoteModelSlot, string[]>>
}
