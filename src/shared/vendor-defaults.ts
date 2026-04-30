import type { Vendor } from './types'

export interface ModelPreset {
  id: string
  label: string
}

interface VendorPresets {
  /** Presets for each model slot. The first entry is the vendor's default. */
  semanticVideo: ModelPreset[]
  semanticSnapshot: ModelPreset[]
  patternDetection: ModelPreset[]
}

interface VendorModelDefaults {
  semanticVideoModel: string
  semanticSnapshotModel: string
  patternDetectionModel: string
}

/**
 * Per-vendor model presets. The first entry in each list is the vendor's
 * default — `getVendorDefaults` derives `VENDOR_DEFAULTS` from these. Empty
 * arrays (e.g. video slot for vendors without video support) yield an empty
 * default string, which the semantic service treats as "skip this slot".
 *
 * The OpenRouter row uses prefix-form ids consumed by openrouter.ai. Every
 * other vendor uses the bare ids accepted by its native AI SDK provider.
 */
export const VENDOR_PRESETS: Record<Vendor, VendorPresets> = {
  openrouter: {
    semanticVideo: [
      { id: 'google/gemini-2.5-flash-lite-preview-09-2025', label: 'Gemini 2.5 Flash Lite' },
      { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
      { id: 'allenai/molmo-2-8b', label: 'Molmo 2 8B' },
    ],
    semanticSnapshot: [
      { id: 'mistralai/mistral-small-3.2-24b-instruct', label: 'Mistral Small 3.2' },
      { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    ],
    patternDetection: [
      { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
      { id: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5' },
    ],
  },
  openai: {
    semanticVideo: [],
    semanticSnapshot: [
      { id: 'gpt-4.1-nano', label: 'GPT-4.1 nano' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    ],
    patternDetection: [
      { id: 'gpt-5-mini', label: 'GPT-5 mini' },
      { id: 'gpt-5', label: 'GPT-5' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
    ],
  },
  anthropic: {
    semanticVideo: [],
    semanticSnapshot: [
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    ],
    patternDetection: [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
    ],
  },
  google: {
    semanticVideo: [
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
    semanticSnapshot: [
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
    patternDetection: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ],
  },
  'openai-compatible': {
    semanticVideo: [],
    semanticSnapshot: [{ id: 'gemma4:e4b', label: 'Gemma 4 e4b' }],
    patternDetection: [{ id: 'gemma4:e4b', label: 'Gemma 4 e4b' }],
  },
}

export function getVendorDefaults(vendor: Vendor): VendorModelDefaults {
  const p = VENDOR_PRESETS[vendor]
  return {
    semanticVideoModel: p.semanticVideo[0]?.id ?? '',
    semanticSnapshotModel: p.semanticSnapshot[0]?.id ?? '',
    patternDetectionModel: p.patternDetection[0]?.id ?? '',
  }
}
