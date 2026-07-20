import log from '@main/utils/logger'
import type { RemoteModelConfig } from '../../shared/remote-model-config'
import type { CaptureSettings } from '../../shared/types'
import { getPresetDefaults } from '../../shared/vendor-defaults'
import { getEffectivePresets } from '@main/settings/effective-model-presets'
import { pushModelSelections, type ModelPushDeps } from './apply-models'

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
  deps: ModelPushDeps,
  settingsManager: RemoteModelSettingsManager,
  config: RemoteModelConfig,
): void {
  const settings = settingsManager.get()
  // Empty remote slots resolve to the baked heads, so a version bump that
  // clears a slot cleanly reverts that pick to the baked default.
  const heads = getPresetDefaults(getEffectivePresets('openrouter', config))

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
  pushModelSelections(deps, current, config)
}
