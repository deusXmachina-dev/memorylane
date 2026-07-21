import type { RemoteModelConfig } from '../../shared/remote-model-config'
import type { CaptureSettings } from '../../shared/types'
import { pushModelSelections, type ModelPushDeps } from './apply-models'

/**
 * Structural shape of the dependencies that `applyModelSettings` touches.
 * Defined separately so the helper is unit-testable without a full
 * `MainWindowDependencies` mock.
 */
export interface ModelSettingsDeps extends ModelPushDeps {
  taskMiner?: {
    updateModel(model: string): void
    updateClusterModel(model: string | null): void
    setEnabled(enabled: boolean): void
  }
  getRemoteModelConfig?: () => RemoteModelConfig | null
}

/**
 * Diff `updated` vs `previous` capture settings and push model-related changes
 * into the live runtime services.
 */
export function applyModelSettings(
  d: ModelSettingsDeps,
  updated: CaptureSettings,
  previous: CaptureSettings,
): void {
  if (
    updated.activeVendor !== previous.activeVendor ||
    updated.semanticVideoModel !== previous.semanticVideoModel ||
    updated.semanticSnapshotModel !== previous.semanticSnapshotModel ||
    updated.patternDetectionModel !== previous.patternDetectionModel
  ) {
    pushModelSelections(d, updated, d.getRemoteModelConfig?.() ?? null)
  }
  if (updated.patternDetectionEnabled !== previous.patternDetectionEnabled) {
    d.taskMiner?.setEnabled(updated.patternDetectionEnabled)
  }
}
