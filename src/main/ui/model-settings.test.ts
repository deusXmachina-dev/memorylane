import { describe, it, expect, vi } from 'vitest'
import { applyModelSettings, type ModelSettingsDeps } from './model-settings'
import type { CaptureSettings } from '../../shared/types'
import { VENDOR_PRESETS } from '../../shared/vendor-defaults'
import { makeCaptureSettings } from '@main/utils/test-utils'

function makeDeps(): {
  deps: ModelSettingsDeps
  semanticService: { updateModels: ReturnType<typeof vi.fn> }
  taskMiner: {
    updateModel: ReturnType<typeof vi.fn>
    updateClusterModel: ReturnType<typeof vi.fn>
    setEnabled: ReturnType<typeof vi.fn>
  }
  userContextBuilder: { updateModel: ReturnType<typeof vi.fn> }
} {
  const semanticService = { updateModels: vi.fn() }
  const taskMiner = { updateModel: vi.fn(), updateClusterModel: vi.fn(), setEnabled: vi.fn() }
  const userContextBuilder = { updateModel: vi.fn() }
  const deps: ModelSettingsDeps = { semanticService, taskMiner, userContextBuilder }
  return { deps, semanticService, taskMiner, userContextBuilder }
}

function makeSettings(overrides: Partial<CaptureSettings> = {}): CaptureSettings {
  return makeCaptureSettings({ semanticPipelineMode: 'image', ...overrides })
}

describe('applyModelSettings', () => {
  it('propagates a changed patternDetectionModel to both taskMiner and userContextBuilder', () => {
    const { deps, taskMiner, userContextBuilder } = makeDeps()
    const previous = makeSettings({ patternDetectionModel: 'old/model' })
    const updated = makeSettings({ patternDetectionModel: 'new/model' })

    applyModelSettings(deps, updated, previous)

    expect(taskMiner.updateModel).toHaveBeenCalledWith('new/model')
    expect(userContextBuilder.updateModel).toHaveBeenCalledWith('new/model')
  })

  it('does not call updateModel when patternDetectionModel is unchanged', () => {
    const { deps, taskMiner, userContextBuilder } = makeDeps()
    const settings = makeSettings({ patternDetectionModel: 'same/model' })

    applyModelSettings(deps, settings, settings)

    expect(taskMiner.updateModel).not.toHaveBeenCalled()
    expect(userContextBuilder.updateModel).not.toHaveBeenCalled()
  })

  it('skips both updateModel calls without throwing when optional services are absent', () => {
    const semanticService = { updateModels: vi.fn() }
    const deps: ModelSettingsDeps = { semanticService }
    const previous = makeSettings({ patternDetectionModel: 'old/model' })
    const updated = makeSettings({ patternDetectionModel: 'new/model' })

    expect(() => applyModelSettings(deps, updated, previous)).not.toThrow()
  })

  it('forwards setEnabled to taskMiner when patternDetectionEnabled flips', () => {
    const { deps, taskMiner, userContextBuilder } = makeDeps()
    const previous = makeSettings({ patternDetectionEnabled: true })
    const updated = makeSettings({ patternDetectionEnabled: false })

    applyModelSettings(deps, updated, previous)

    expect(taskMiner.setEnabled).toHaveBeenCalledWith(false)
    expect(userContextBuilder.updateModel).not.toHaveBeenCalled()
  })

  it('refreshes semantic models when video/snapshot model or vendor changes', () => {
    const { deps, semanticService } = makeDeps()
    const previous = makeSettings({
      semanticVideoModel: VENDOR_PRESETS.openrouter.semanticVideo[0].id,
    })
    const newPick = VENDOR_PRESETS.openrouter.semanticVideo[1].id
    const updated = makeSettings({ semanticVideoModel: newPick })

    applyModelSettings(deps, updated, previous)

    expect(semanticService.updateModels).toHaveBeenCalledTimes(1)
    const [videoModels] = semanticService.updateModels.mock.calls[0] as [string[], string[]]
    expect(videoModels[0]).toBe(newPick)
  })

  it('does not refresh semantic models when nothing model-related changed', () => {
    const { deps, semanticService } = makeDeps()
    const settings = makeSettings()

    applyModelSettings(deps, settings, settings)

    expect(semanticService.updateModels).not.toHaveBeenCalled()
  })

  it('managed: pushes remote chains verbatim and ignores stored picks', () => {
    const { deps, semanticService, taskMiner, userContextBuilder } = makeDeps()
    deps.isManaged = () => true
    deps.getRemoteModelConfig = () => ({
      version: 2,
      models: {
        semanticVideo: ['remote/video-a', 'remote/video-b'],
        taskMining: ['remote/miner'],
        userContext: ['remote/context-model'],
        clusterReview: ['remote/cluster'],
      },
    })
    const previous = makeSettings({ patternDetectionModel: 'old/model' })
    const updated = makeSettings({
      semanticVideoModel: 'ignored/pick',
      patternDetectionModel: 'new/model',
    })

    applyModelSettings(deps, updated, previous)

    const [videoModels, snapshotModels] = semanticService.updateModels.mock.calls[0] as [
      string[],
      string[],
    ]
    expect(videoModels).toEqual(['remote/video-a', 'remote/video-b'])
    expect(snapshotModels).toEqual(VENDOR_PRESETS.openrouter.semanticSnapshot.map((p) => p.id))
    expect(taskMiner.updateModel).toHaveBeenCalledWith('remote/miner')
    expect(taskMiner.updateClusterModel).toHaveBeenCalledWith('remote/cluster')
    expect(userContextBuilder.updateModel).toHaveBeenCalledWith('remote/context-model')
  })
})
