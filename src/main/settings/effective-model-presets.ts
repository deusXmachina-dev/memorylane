import type { RemoteModelConfig } from '../../shared/remote-model-config'
import type { Vendor } from '../../shared/types'
import { VENDOR_PRESETS, type ModelPreset, type VendorPresets } from '../../shared/vendor-defaults'

function toPresets(chain: string[], baked: ModelPreset[]): ModelPreset[] {
  return chain.map((id) => ({ id, label: baked.find((p) => p.id === id)?.label ?? id }))
}

/**
 * The vendor's preset lists with the remote model config layered on top.
 * Remote config is OpenRouter-only: for that vendor a non-empty remote slot
 * replaces the baked list (first entry = the remotely-enforced default), an
 * empty/missing slot falls through to the baked presets. Other vendors — and a
 * null config — return the baked presets untouched.
 */
export function getEffectivePresets(
  vendor: Vendor,
  remote: RemoteModelConfig | null,
): VendorPresets {
  const baked = VENDOR_PRESETS[vendor]
  if (vendor !== 'openrouter' || remote === null) return baked
  const { semanticVideo, semanticSnapshot, taskMining } = remote.models
  return {
    semanticVideo: semanticVideo?.length
      ? toPresets(semanticVideo, baked.semanticVideo)
      : baked.semanticVideo,
    semanticSnapshot: semanticSnapshot?.length
      ? toPresets(semanticSnapshot, baked.semanticSnapshot)
      : baked.semanticSnapshot,
    patternDetection: taskMining?.length
      ? toPresets(taskMining, baked.patternDetection)
      : baked.patternDetection,
  }
}

/**
 * The user-context builder follows the stored `patternDetectionModel` pick
 * unless remote config (OpenRouter only) points it at its own model.
 */
export function resolveUserContextModel(
  patternDetectionPick: string,
  vendor: Vendor,
  remote: RemoteModelConfig | null,
): string {
  if (vendor !== 'openrouter') return patternDetectionPick
  return remote?.models.userContext?.[0] ?? patternDetectionPick
}

/**
 * The TaskMiner clustering-pass override; null = follow the miner model.
 * OpenRouter only — any other vendor must never run a remote OpenRouter id.
 */
export function resolveClusterModelOverride(
  vendor: Vendor,
  remote: RemoteModelConfig | null,
): string | null {
  if (vendor !== 'openrouter') return null
  return remote?.models.clusterReview?.[0] ?? null
}
