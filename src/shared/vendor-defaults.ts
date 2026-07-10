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
 * are treated as authoritative — an upgrade replaces stale/retired ids (e.g.
 * `-preview` snapshots that later 404) rather than stranding a seat on them.
 */
export const MODEL_DEFAULTS_VERSION = 2

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
    // GA ids only — preview ids resolve on Google AI Studio but 404 on
    // Vertex-pinned (ZDR) keys, and are the class that gets retired. All four
    // verified available under the ZDR OpenRouter key (2026-07-10), ordered by
    // cost-efficiency: gemini-3.1-flash-lite (~60 tok/frame, $0.25/M) heads it;
    // gemini-2.5-flash is the quality-max floor.
    semanticVideo: [
      { id: 'google/gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
      { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
      { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
    semanticSnapshot: [
      { id: 'mistralai/mistral-small-3.2-24b-instruct', label: 'Mistral Small 3.2' },
      { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    ],
    // Task-miner models, ordered by the 2026-07-03 sweep
    // (findings/task-mining-benchmark.md); first entry is the default and heads
    // the fallback chain. ZDR-capable models only — the sweep's cheapest option
    // (tencent/hy3-preview, 78% @ $0.006) is deliberately excluded because it
    // has NO ZDR endpoints on OpenRouter and fails under a zero-data-retention
    // key policy. minimax-m3 won on recall (84% @ ~$0.04/day); mimo-v2.5 is the
    // value pick (82% @ $0.015); gemini-2.5-flash is the reliable lower-recall
    // fallback (the previous default).
    patternDetection: [
      { id: 'minimax/minimax-m3', label: 'MiniMax M3' },
      { id: 'xiaomi/mimo-v2.5', label: 'MiMo V2.5' },
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
  },
  google: {
    semanticVideo: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }],
    semanticSnapshot: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }],
    patternDetection: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }],
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
