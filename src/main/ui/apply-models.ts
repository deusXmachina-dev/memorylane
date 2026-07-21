import type { RemoteModelConfig } from '../../shared/remote-model-config'
import type { CaptureSettings } from '../../shared/types'
import { buildModelChain } from '../../shared/vendor-defaults'
import {
  getEffectivePresets,
  resolveClusterModelOverride,
  resolveUserContextModel,
} from '@main/settings/effective-model-presets'

/** Structural shape of every live service that consumes a model selection. */
export interface ModelPushDeps {
  semanticService: {
    updateModels(videoModels: string[], snapshotModels: string[]): void
  }
  userContextBuilder?: { updateModel(model: string): void }
  taskMiner?: {
    updateModel(model: string): void
    updateClusterModel(model: string | null): void
  }
}

type ModelSelection = Pick<
  CaptureSettings,
  'activeVendor' | 'semanticVideoModel' | 'semanticSnapshotModel' | 'patternDetectionModel'
>

/**
 * Push the effective model selections (stored picks + remote config) into the
 * live services. Idempotent — the single choke point shared by startup seeding,
 * vendor switches, settings saves, and remote-config notifications.
 */
export function pushModelSelections(
  d: ModelPushDeps,
  s: ModelSelection,
  remote: RemoteModelConfig | null,
): void {
  const presets = getEffectivePresets(s.activeVendor, remote)
  d.semanticService.updateModels(
    buildModelChain(s.semanticVideoModel, presets.semanticVideo),
    buildModelChain(s.semanticSnapshotModel, presets.semanticSnapshot),
  )
  d.taskMiner?.updateModel(s.patternDetectionModel)
  d.taskMiner?.updateClusterModel(resolveClusterModelOverride(s.activeVendor, remote))
  d.userContextBuilder?.updateModel(
    resolveUserContextModel(s.patternDetectionModel, s.activeVendor, remote),
  )
}
