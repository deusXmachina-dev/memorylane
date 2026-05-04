import type { CaptureSettings } from '../../shared/types'
import { VENDOR_PRESETS, buildModelChain } from '../../shared/vendor-defaults'

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
  if (
    updated.semanticVideoModel !== previous.semanticVideoModel ||
    updated.semanticSnapshotModel !== previous.semanticSnapshotModel ||
    updated.activeVendor !== previous.activeVendor
  ) {
    const presets = VENDOR_PRESETS[updated.activeVendor]
    d.semanticService.updateModels(
      buildModelChain(updated.semanticVideoModel, presets.semanticVideo),
      buildModelChain(updated.semanticSnapshotModel, presets.semanticSnapshot),
    )
  }
  if (updated.patternDetectionModel !== previous.patternDetectionModel) {
    d.patternDetector?.updateModel(updated.patternDetectionModel)
    d.userContextBuilder?.updateModel(updated.patternDetectionModel)
  }
  if (updated.patternDetectionEnabled !== previous.patternDetectionEnabled) {
    d.patternDetector?.setEnabled(updated.patternDetectionEnabled)
  }
}
