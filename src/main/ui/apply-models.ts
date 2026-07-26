import type { RemoteModelConfig } from '../../shared/remote-model-config'
import type { CaptureSettings, Vendor } from '../../shared/types'
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

function bakedDefaults(vendor: Vendor): ResolvedModelPush {
  const presets = VENDOR_PRESETS[vendor]
  const miner = presets.patternDetection[0]?.id ?? ''
  return {
    videoModels: presets.semanticVideo.map((p) => p.id),
    snapshotModels: presets.semanticSnapshot.map((p) => p.id),
    minerModel: miner,
    clusterModel: null,
    userContextModel: miner,
  }
}

export function resolveModelPush(
  s: ModelSelection,
  remote: RemoteModelConfig | null,
  managed: boolean,
): ResolvedModelPush {
  if (managed) {
    // Remote chains win slot by slot; empty/missing slots fall back to the
    // baked defaults so a model is always available.
    const baked = bakedDefaults(s.activeVendor)
    const models = remote?.models
    return {
      videoModels: models?.semanticVideo?.length ? models.semanticVideo : baked.videoModels,
      snapshotModels: models?.semanticSnapshot?.length
        ? models.semanticSnapshot
        : baked.snapshotModels,
      minerModel: models?.taskMining?.[0] ?? baked.minerModel,
      clusterModel: models?.clusterReview?.[0] ?? null,
      userContextModel: models?.userContext?.[0] ?? baked.userContextModel,
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
