import { describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import type { RemoteModelConfig } from '../../shared/remote-model-config'
import type { CaptureSettings } from '../../shared/types'
import { VENDOR_PRESETS } from '../../shared/vendor-defaults'
import { makeCaptureSettings as makeSettings } from '@main/utils/test-utils'
import type { ModelPushDeps } from './apply-models'
import { applyRemoteModelConfig, type RemoteModelSettingsManager } from './remote-model-apply'

const REMOTE: RemoteModelConfig = {
  version: 3,
  models: {
    semanticVideo: ['remote/video-model', 'google/gemini-2.5-flash'],
    semanticSnapshot: ['remote/snapshot-model'],
    taskMining: ['remote/mining-model'],
    userContext: ['remote/context-model'],
    clusterReview: ['remote/cluster-model'],
  },
}

function makeManager(initial: CaptureSettings): RemoteModelSettingsManager & {
  save: ReturnType<typeof vi.fn>
} {
  let settings = initial
  const save = vi.fn((partial: Partial<CaptureSettings>) => {
    settings = { ...settings, ...partial }
    // Mirror of CaptureSettingsManager.save: flat picks land in the active
    // vendor's map entry unless an explicit map was passed.
    if (partial.modelsByVendor === undefined) {
      settings.modelsByVendor = {
        ...settings.modelsByVendor,
        [settings.activeVendor]: {
          semanticVideoModel: settings.semanticVideoModel,
          semanticSnapshotModel: settings.semanticSnapshotModel,
          patternDetectionModel: settings.patternDetectionModel,
          semanticPipelineMode: settings.semanticPipelineMode,
        },
      }
    }
  })
  return { get: () => ({ ...settings }), save }
}

function makeDeps(): {
  deps: ModelPushDeps
  semanticService: { updateModels: ReturnType<typeof vi.fn> }
  userContextBuilder: { updateModel: ReturnType<typeof vi.fn> }
  taskMiner: {
    updateModel: ReturnType<typeof vi.fn>
    updateClusterModel: ReturnType<typeof vi.fn>
  }
} {
  const semanticService = { updateModels: vi.fn() }
  const userContextBuilder = { updateModel: vi.fn() }
  const taskMiner = { updateModel: vi.fn(), updateClusterModel: vi.fn() }
  return {
    deps: { semanticService, userContextBuilder, taskMiner },
    semanticService,
    userContextBuilder,
    taskMiner,
  }
}

describe('applyRemoteModelConfig', () => {
  it('overwrites picks and records the version when it advances', () => {
    const manager = makeManager(makeSettings())
    const { deps } = makeDeps()

    applyRemoteModelConfig(deps, manager, REMOTE)

    const settings = manager.get()
    expect(settings.semanticVideoModel).toBe('remote/video-model')
    expect(settings.semanticSnapshotModel).toBe('remote/snapshot-model')
    expect(settings.patternDetectionModel).toBe('remote/mining-model')
    expect(settings.remoteModelConfigVersion).toBe(3)
  })

  it('does not overwrite picks at an equal or lower version but still pushes live chains', () => {
    const manager = makeManager(
      makeSettings({ remoteModelConfigVersion: 3, semanticVideoModel: 'user/custom-pick' }),
    )
    const { deps, semanticService } = makeDeps()

    applyRemoteModelConfig(deps, manager, REMOTE)

    expect(manager.save).not.toHaveBeenCalled()
    expect(manager.get().semanticVideoModel).toBe('user/custom-pick')
    // The live chain still reflects the remote presets under the user's pick.
    const [videoModels] = semanticService.updateModels.mock.calls[0] as [string[], string[]]
    expect(videoModels).toEqual([
      'user/custom-pick',
      'remote/video-model',
      'google/gemini-2.5-flash',
    ])
  })

  it('reverts a slot to the baked default when a newer config leaves it empty', () => {
    const manager = makeManager(
      makeSettings({ remoteModelConfigVersion: 1, semanticVideoModel: 'old-remote/model' }),
    )
    const { deps } = makeDeps()

    applyRemoteModelConfig(deps, manager, {
      version: 2,
      models: { taskMining: ['remote/mining-model'] },
    })

    expect(manager.get().semanticVideoModel).toBe(VENDOR_PRESETS.openrouter.semanticVideo[0].id)
    expect(manager.get().patternDetectionModel).toBe('remote/mining-model')
  })

  it('writes the openrouter map entry when another vendor is active, without live pushes', () => {
    const manager = makeManager(
      makeSettings({
        activeVendor: 'google',
        semanticVideoModel: 'gemini-2.5-flash',
        modelsByVendor: {
          openrouter: {
            semanticVideoModel: 'user/old-pick',
            semanticSnapshotModel: 'user/old-pick',
            patternDetectionModel: 'user/old-pick',
            semanticPipelineMode: 'image',
          },
        },
      }),
    )
    const { deps, semanticService, taskMiner } = makeDeps()

    applyRemoteModelConfig(deps, manager, REMOTE)

    const settings = manager.get()
    // The active vendor's flat picks are untouched…
    expect(settings.semanticVideoModel).toBe('gemini-2.5-flash')
    // …while the remembered openrouter selection is overwritten, mode preserved.
    expect(settings.modelsByVendor.openrouter).toEqual({
      semanticVideoModel: 'remote/video-model',
      semanticSnapshotModel: 'remote/snapshot-model',
      patternDetectionModel: 'remote/mining-model',
      semanticPipelineMode: 'image',
    })
    expect(settings.remoteModelConfigVersion).toBe(3)
    expect(semanticService.updateModels).not.toHaveBeenCalled()
    expect(taskMiner.updateClusterModel).not.toHaveBeenCalled()
  })

  it('pushes diverged text-task models and the cluster override live', () => {
    const manager = makeManager(makeSettings())
    const { deps, userContextBuilder, taskMiner } = makeDeps()

    applyRemoteModelConfig(deps, manager, REMOTE)

    expect(taskMiner.updateModel).toHaveBeenCalledWith('remote/mining-model')
    expect(userContextBuilder.updateModel).toHaveBeenCalledWith('remote/context-model')
    expect(taskMiner.updateClusterModel).toHaveBeenCalledWith('remote/cluster-model')
  })

  it('clears the cluster override when the config has no clusterReview slot', () => {
    const manager = makeManager(makeSettings())
    const { deps, taskMiner } = makeDeps()

    applyRemoteModelConfig(deps, manager, { version: 4, models: {} })

    expect(taskMiner.updateClusterModel).toHaveBeenCalledWith(null)
  })

  it('is idempotent across repeated notifications of the same config', () => {
    const manager = makeManager(makeSettings())
    const { deps } = makeDeps()

    applyRemoteModelConfig(deps, manager, REMOTE)
    applyRemoteModelConfig(deps, manager, REMOTE)

    expect(manager.save).toHaveBeenCalledTimes(1)
  })
})
