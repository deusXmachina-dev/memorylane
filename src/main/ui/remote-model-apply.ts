import log from '@main/utils/logger'
import type { RemoteModelConfig } from '../../shared/remote-model-config'
import type { CaptureSettings } from '../../shared/types'
import { buildModelChain } from '../../shared/vendor-defaults'
import { getEffectivePresets, resolveTextTaskModels } from '@main/settings/effective-model-presets'

export interface RemoteModelApplyDeps {
  semanticService: {
    updateModels(videoModels: string[], snapshotModels: string[]): void
  }
  patternDetector?: { updateModel(model: string): void }
  userContextBuilder?: { updateModel(model: string): void }
  taskMiner?: { updateClusterModel(model: string | null): void }
}

export interface RemoteModelSettingsManager {
  get(): CaptureSettings
  save(partial: Partial<CaptureSettings>): void
}

/**
 * Applies a remote model config: overwrites the stored OpenRouter picks when
 * the config's version advances past the last-applied one (same authoritative
 * semantics as MODEL_DEFAULTS_VERSION), then pushes the effective chains into
 * the live services when OpenRouter is the active vendor. Idempotent — safe to
 * call on every config notification, including the cached load at startup.
 */
export function applyRemoteModelConfig(
  deps: RemoteModelApplyDeps,
  settingsManager: RemoteModelSettingsManager,
  config: RemoteModelConfig,
): void {
  const settings = settingsManager.get()
  const presets = getEffectivePresets('openrouter', config)
  // Empty remote slots resolve to the baked heads, so a version bump that
  // clears a slot cleanly reverts that pick to the baked default.
  const heads = {
    semanticVideoModel: presets.semanticVideo[0]?.id ?? '',
    semanticSnapshotModel: presets.semanticSnapshot[0]?.id ?? '',
    patternDetectionModel: presets.patternDetection[0]?.id ?? '',
  }

  const appliedVersion = settings.remoteModelConfigVersion ?? 0
  if (config.version > appliedVersion) {
    if (settings.activeVendor === 'openrouter') {
      // save() mirrors the flat picks into modelsByVendor.openrouter.
      settingsManager.save({ ...heads, remoteModelConfigVersion: config.version })
    } else {
      const remembered = settings.modelsByVendor.openrouter
      settingsManager.save({
        modelsByVendor: {
          ...settings.modelsByVendor,
          openrouter: {
            ...heads,
            semanticPipelineMode: remembered?.semanticPipelineMode ?? settings.semanticPipelineMode,
          },
        },
        remoteModelConfigVersion: config.version,
      })
    }
    log.info(
      `[RemoteModelConfig] Applied config v${config.version} (was v${appliedVersion}), ` +
        `overwrote OpenRouter model picks`,
    )
  }

  const current = settingsManager.get()
  if (current.activeVendor !== 'openrouter') return
  deps.semanticService.updateModels(
    buildModelChain(current.semanticVideoModel, presets.semanticVideo),
    buildModelChain(current.semanticSnapshotModel, presets.semanticSnapshot),
  )
  const text = resolveTextTaskModels(current.patternDetectionModel, 'openrouter', config)
  deps.patternDetector?.updateModel(text.taskMining)
  deps.userContextBuilder?.updateModel(text.userContext)
  deps.taskMiner?.updateClusterModel(config.models.clusterReview?.[0] ?? null)
}
