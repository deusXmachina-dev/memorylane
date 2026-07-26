import type { RemoteModelConfig } from '../../shared/remote-model-config'
import type { CaptureSettings, SemanticPipelineMode } from '../../shared/types'
import { VENDOR_PRESETS, buildModelChain } from '../../shared/vendor-defaults'

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

export interface ResolvedModelPush {
  videoModels: string[]
  snapshotModels: string[]
  minerModel: string
  clusterModel: string | null
  userContextModel: string
}

export function resolveModelPush(
  s: ModelSelection,
  remote: RemoteModelConfig | null,
  managed: boolean,
): ResolvedModelPush {
  if (managed) {
    return {
      videoModels: remote?.models.semanticVideo ?? [],
      snapshotModels: remote?.models.semanticSnapshot ?? [],
      minerModel: remote?.models.taskMining?.[0] ?? '',
      clusterModel: remote?.models.clusterReview?.[0] ?? null,
      userContextModel: remote?.models.userContext?.[0] ?? '',
    }
  }
  const presets = VENDOR_PRESETS[s.activeVendor]
  return {
    videoModels: buildModelChain(s.semanticVideoModel, presets.semanticVideo),
    snapshotModels: buildModelChain(s.semanticSnapshotModel, presets.semanticSnapshot),
    minerModel: s.patternDetectionModel,
    clusterModel: null,
    userContextModel: s.patternDetectionModel,
  }
}

/**
 * Whether the remote config carries a model for the pipeline stage that
 * terminates summarization under the given mode: `video` ends on the video
 * chain, `auto` and `image` end on the snapshot chain.
 */
export function hasRequiredSemanticModels(
  remote: RemoteModelConfig | null,
  mode: SemanticPipelineMode,
): boolean {
  const models = remote?.models
  if (mode === 'video') return Boolean(models?.semanticVideo?.length)
  return Boolean(models?.semanticSnapshot?.length)
}

/**
 * Push the effective model selections into the live services. Idempotent —
 * the single choke point shared by startup seeding, vendor switches, settings
 * saves, and remote-config notifications.
 */
export function pushModelSelections(
  d: ModelPushDeps,
  s: ModelSelection,
  remote: RemoteModelConfig | null,
  managed: boolean,
): void {
  const r = resolveModelPush(s, remote, managed)
  d.semanticService.updateModels(r.videoModels, r.snapshotModels)
  d.taskMiner?.updateModel(r.minerModel)
  d.taskMiner?.updateClusterModel(r.clusterModel)
  d.userContextBuilder?.updateModel(r.userContextModel)
}
