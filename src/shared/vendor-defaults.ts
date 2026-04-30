import type { Vendor } from './types'

interface VendorModelDefaults {
  semanticVideoModel: string
  semanticSnapshotModel: string
  patternDetectionModel: string
  userContextModel: string
}

/**
 * Per-vendor model defaults. An empty string means "vendor doesn't have a
 * preset for this slot" — the user must fill it, or (for the video slot) the
 * semantic service will fall back to the snapshot path.
 *
 * The OpenRouter row uses prefix-form ids consumed by openrouter.ai.
 */
export const VENDOR_DEFAULTS: Record<Vendor, VendorModelDefaults> = {
  openrouter: {
    semanticVideoModel: 'google/gemini-3-flash-preview',
    semanticSnapshotModel: 'mistralai/mistral-small-3.2-24b-instruct',
    patternDetectionModel: 'google/gemini-3-flash-preview',
    userContextModel: 'google/gemini-3-flash-preview',
  },
  openai: {
    semanticVideoModel: '',
    semanticSnapshotModel: 'gpt-4o-mini',
    patternDetectionModel: 'gpt-4o-mini',
    userContextModel: 'gpt-4o-mini',
  },
  anthropic: {
    semanticVideoModel: '',
    semanticSnapshotModel: 'claude-haiku-4-5',
    patternDetectionModel: 'claude-sonnet-4-6',
    userContextModel: 'claude-sonnet-4-6',
  },
  google: {
    semanticVideoModel: 'gemini-2.5-flash',
    semanticSnapshotModel: 'gemini-2.5-flash',
    patternDetectionModel: 'gemini-2.5-flash',
    userContextModel: 'gemini-2.5-flash',
  },
  'openai-compatible': {
    semanticVideoModel: '',
    semanticSnapshotModel: '',
    patternDetectionModel: '',
    userContextModel: '',
  },
}

export function getVendorDefaults(vendor: Vendor): VendorModelDefaults {
  return VENDOR_DEFAULTS[vendor]
}
