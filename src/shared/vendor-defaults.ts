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
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'allenai/molmo-2-8b', label: 'Molmo 2 8B' },
    ],
    semanticSnapshot: [
      { id: 'mistralai/mistral-small-3.2-24b-instruct', label: 'Mistral Small 3.2' },
      { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    ],
    patternDetection: [
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5' },
    ],
  },
  google: {
    semanticVideo: [
      { id: 'gemini-2.5-flash-lite-preview-09-2025', label: 'Gemini 2.5 Flash Lite (preview)' },
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
  // Local OpenAI-compatible endpoints (Ollama, LM Studio, vLLM) ship no
  // defaults — the user's local catalog varies per machine, so any preset
  // would be wrong for most installs. The user picks a model id explicitly.
  'openai-compatible': {
    semanticVideo: [],
    semanticSnapshot: [],
    patternDetection: [],
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

/**
 * Build a model fallback chain: user's pick first, then the remaining vendor
 * presets as a tail. Empty userPick yields the preset list as-is. A pick that
 * matches a preset is filtered out of the tail to avoid retrying it.
 */
export function buildModelChain(userPick: string, presets: ModelPreset[]): string[] {
  const presetIds = presets.map((p) => p.id)
  if (!userPick) return presetIds
  return [userPick, ...presetIds.filter((id) => id !== userPick)]
}
