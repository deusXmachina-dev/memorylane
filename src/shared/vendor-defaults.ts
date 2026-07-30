import type { Vendor } from './types'

export interface ModelPreset {
  id: string
  label: string
}

/**
 * Bump whenever the preset lists below change in a way that should be pushed to
 * existing installs. On load, a stored `modelDefaultsVersion` older than this
 * causes the manager to overwrite the user's remembered model picks with the
 * current vendor defaults (see CaptureSettingsManager.load). Curated defaults
 * are authoritative — an upgrade replaces stale/retired ids rather than
 * stranding a seat on them.
 */
export const MODEL_DEFAULTS_VERSION = 3

export interface VendorPresets {
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
    // GA ids only, ordered by cost-efficiency.
    semanticVideo: [
      { id: 'google/gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
      { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
      { id: 'google/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
      { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    ],
    semanticSnapshot: [
      { id: 'mistralai/mistral-small-3.2-24b-instruct', label: 'Mistral Small 3.2' },
      { id: 'google/gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
    ],
    // ZDR-capable only, ordered by findings/task-mining-benchmark.md.
    patternDetection: [
      { id: 'minimax/minimax-m3', label: 'MiniMax M3' },
      { id: 'xiaomi/mimo-v2.5', label: 'MiMo V2.5' },
      { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    ],
  },
  google: {
    semanticVideo: [{ id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' }],
    semanticSnapshot: [{ id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' }],
    patternDetection: [{ id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' }],
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

/** The default pick per slot: the head of each preset list, '' when empty. */
export function getPresetDefaults(p: VendorPresets): VendorModelDefaults {
  return {
    semanticVideoModel: p.semanticVideo[0]?.id ?? '',
    semanticSnapshotModel: p.semanticSnapshot[0]?.id ?? '',
    patternDetectionModel: p.patternDetection[0]?.id ?? '',
  }
}

export function getVendorDefaults(vendor: Vendor): VendorModelDefaults {
  return getPresetDefaults(VENDOR_PRESETS[vendor])
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
