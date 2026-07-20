import type { RemoteModelConfig } from '../../shared/remote-model-config'
import type { CaptureSettings } from '../../shared/types'
import { buildModelChain } from '../../shared/vendor-defaults'
import { getEffectivePresets, resolveTextTaskModels } from '@main/settings/effective-model-presets'

/**
 * Structural shape of the dependencies that `applyModelSettings` touches.
 * Defined separately so the helper is unit-testable without a full
 * `MainWindowDependencies` mock.
 */
export interface ModelSettingsDeps {
  semanticService: {
    updateModels(videoModels: string[], snapshotModels: string[]): void
  }
  patternDetector?: { updateModel(model: string): void; setEnabled(enabled: boolean): void }
  userContextBuilder?: { updateModel(model: string): void }
  getRemoteModelConfig?: () => RemoteModelConfig | null
}

/**
 * Diff `updated` vs `previous` capture settings and push only the changed
 * model-related fields into the live runtime services.
 */
export function applyModelSettings(
  d: ModelSettingsDeps,
  updated: CaptureSettings,
  previous: CaptureSettings,
): void {
  const remote = d.getRemoteModelConfig?.() ?? null
  if (
    updated.semanticVideoModel !== previous.semanticVideoModel ||
    updated.semanticSnapshotModel !== previous.semanticSnapshotModel ||
    updated.activeVendor !== previous.activeVendor
  ) {
    const presets = getEffectivePresets(updated.activeVendor, remote)
    d.semanticService.updateModels(
      buildModelChain(updated.semanticVideoModel, presets.semanticVideo),
      buildModelChain(updated.semanticSnapshotModel, presets.semanticSnapshot),
    )
  }
  if (updated.patternDetectionModel !== previous.patternDetectionModel) {
    const text = resolveTextTaskModels(updated.patternDetectionModel, updated.activeVendor, remote)
    d.patternDetector?.updateModel(text.taskMining)
    d.userContextBuilder?.updateModel(text.userContext)
  }
  if (updated.patternDetectionEnabled !== previous.patternDetectionEnabled) {
    d.patternDetector?.setEnabled(updated.patternDetectionEnabled)
  }
}
