import type { RemoteModelConfig } from '../../shared/remote-model-config'
import type { CaptureSettings, SemanticPipelineMode } from '../../shared/types'
import { pushModelSelections, type ModelPushDeps } from './apply-models'

/**
 * Structural shape of the dependencies that `applyVendorSwitch` touches.
 * Defined separately so the helper is unit-testable without a full
 * `MainWindowDependencies` mock.
 */
export interface VendorSwitchDeps extends ModelPushDeps {
  semanticService: ModelPushDeps['semanticService'] & {
    updatePipelinePreference(mode: SemanticPipelineMode): void
    testConnection(): Promise<void>
  }
  inferenceProvider: { notifyConfigChanged(): void }
  getRemoteModelConfig?: () => RemoteModelConfig | null
  isManaged?: () => boolean
}

/**
 * Push the freshly-persisted vendor settings into the live runtime.
 *
 * Called from the `setActiveVendor` IPC handler after
 * `captureSettingsManager.setActiveVendor` writes the new vendor + reset
 * model fields + pipeline mode to disk. Without this glue the in-memory
 * `SemanticService` keeps running with whatever state it was constructed
 * with.
 */
export function applyVendorSwitch(d: VendorSwitchDeps, next: CaptureSettings): void {
  pushModelSelections(d, next, d.getRemoteModelConfig?.() ?? null, d.isManaged?.() ?? false)
  d.semanticService.updatePipelinePreference(next.semanticPipelineMode)
  d.inferenceProvider.notifyConfigChanged()
  void d.semanticService.testConnection()
}
