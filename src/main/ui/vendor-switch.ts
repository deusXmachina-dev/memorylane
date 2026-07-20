import type { RemoteModelConfig } from '../../shared/remote-model-config'
import type { CaptureSettings, SemanticPipelineMode } from '../../shared/types'
import { buildModelChain } from '../../shared/vendor-defaults'
import {
  getEffectivePresets,
  resolveClusterModelOverride,
  resolveTextTaskModels,
} from '@main/settings/effective-model-presets'

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
  userContextBuilder?: { updateModel(model: string): void }
  taskMiner?: { updateClusterModel(model: string | null): void }
  inferenceProvider: { notifyConfigChanged(): void }
  getRemoteModelConfig?: () => RemoteModelConfig | null
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
  const remote = d.getRemoteModelConfig?.() ?? null
  const presets = getEffectivePresets(next.activeVendor, remote)
  d.semanticService.updateModels(
    buildModelChain(next.semanticVideoModel, presets.semanticVideo),
    buildModelChain(next.semanticSnapshotModel, presets.semanticSnapshot),
  )
  d.semanticService.updatePipelinePreference(next.semanticPipelineMode)
  const text = resolveTextTaskModels(next.patternDetectionModel, next.activeVendor, remote)
  d.patternDetector?.updateModel(text.taskMining)
  d.userContextBuilder?.updateModel(text.userContext)
  d.taskMiner?.updateClusterModel(resolveClusterModelOverride(next.activeVendor, remote))
  d.inferenceProvider.notifyConfigChanged()
  void d.semanticService.testConnection()
}
