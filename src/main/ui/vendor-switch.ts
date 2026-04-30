import type { CaptureSettings, SemanticPipelineMode } from '../../shared/types'
import { VENDOR_PRESETS, buildModelChain } from '../../shared/vendor-defaults'

/**
 * Structural shape of the dependencies that `applyVendorSwitch` touches.
 * Defined separately so the helper is unit-testable without a full
 * `MainWindowDependencies` mock.
 */
export interface VendorSwitchDeps {
  semanticService: {
    updateModels(videoModels: string[], snapshotModels: string[]): void
    updatePipelinePreference(mode: SemanticPipelineMode): void
    testConnection(): Promise<void>
  }
  patternDetector?: { updateModel(model: string): void }
  inferenceProvider: { notifyConfigChanged(): void }
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
  const presets = VENDOR_PRESETS[next.activeVendor]
  d.semanticService.updateModels(
    buildModelChain(next.semanticVideoModel, presets.semanticVideo),
    buildModelChain(next.semanticSnapshotModel, presets.semanticSnapshot),
  )
  d.semanticService.updatePipelinePreference(next.semanticPipelineMode)
  d.patternDetector?.updateModel(next.patternDetectionModel)
  d.inferenceProvider.notifyConfigChanged()
  void d.semanticService.testConnection()
}
