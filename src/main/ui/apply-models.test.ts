import { describe, it, expect, vi } from 'vitest'
import { resolveModelPush, pushModelSelections, hasRequiredSemanticModels } from './apply-models'
import { VENDOR_PRESETS, buildModelChain } from '../../shared/vendor-defaults'
import { makeCaptureSettings } from '@main/utils/test-utils'
import type { RemoteModelConfig } from '../../shared/remote-model-config'

const remote: RemoteModelConfig = {
  version: 3,
  models: {
    semanticVideo: ['remote/video-a', 'remote/video-b'],
    semanticSnapshot: ['remote/snapshot'],
    taskMining: ['remote/miner', 'remote/miner-fallback'],
    userContext: ['remote/context'],
    clusterReview: ['remote/cluster'],
  },
}

describe('resolveModelPush', () => {
  it('managed: returns remote chains verbatim and ignores stored picks', () => {
    const settings = makeCaptureSettings({
      semanticVideoModel: 'stored/video',
      semanticSnapshotModel: 'stored/snapshot',
      patternDetectionModel: 'stored/miner',
    })

    const r = resolveModelPush(settings, remote, true)

    expect(r.videoModels).toEqual(['remote/video-a', 'remote/video-b'])
    expect(r.snapshotModels).toEqual(['remote/snapshot'])
    expect(r.minerModel).toBe('remote/miner')
    expect(r.clusterModel).toBe('remote/cluster')
    expect(r.userContextModel).toBe('remote/context')
  })

  it('managed: no config yet resolves to the baked vendor defaults, ignoring stored picks', () => {
    const settings = makeCaptureSettings({ semanticVideoModel: 'stored/video' })

    const r = resolveModelPush(settings, null, true)

    expect(r.videoModels).toEqual(VENDOR_PRESETS.openrouter.semanticVideo.map((p) => p.id))
    expect(r.snapshotModels).toEqual(VENDOR_PRESETS.openrouter.semanticSnapshot.map((p) => p.id))
    expect(r.minerModel).toBe(VENDOR_PRESETS.openrouter.patternDetection[0].id)
    expect(r.userContextModel).toBe(r.minerModel)
    expect(r.clusterModel).toBeNull()
  })

  it('managed: baked defaults follow the active vendor', () => {
    const settings = makeCaptureSettings({ activeVendor: 'google' })

    const r = resolveModelPush(settings, null, true)

    expect(r.videoModels).toEqual(VENDOR_PRESETS.google.semanticVideo.map((p) => p.id))
  })

  it('managed: a fetched config with empty slots idles, never falls back to defaults', () => {
    const settings = makeCaptureSettings()

    const emptySlots = resolveModelPush(settings, { version: 1, models: {} }, true)
    expect(emptySlots.videoModels).toEqual([])
    expect(emptySlots.snapshotModels).toEqual([])
    expect(emptySlots.minerModel).toBe('')
    expect(emptySlots.clusterModel).toBeNull()
    expect(emptySlots.userContextModel).toBe('')
  })

  it('byok: builds pick-headed chains from the baked presets', () => {
    const pick = VENDOR_PRESETS.openrouter.semanticVideo[1].id
    const settings = makeCaptureSettings({ semanticVideoModel: pick })

    const r = resolveModelPush(settings, null, false)

    expect(r.videoModels).toEqual(buildModelChain(pick, VENDOR_PRESETS.openrouter.semanticVideo))
    expect(r.videoModels[0]).toBe(pick)
    expect(r.minerModel).toBe(settings.patternDetectionModel)
    expect(r.userContextModel).toBe(settings.patternDetectionModel)
    expect(r.clusterModel).toBeNull()
  })

  it('byok: never consults the remote config', () => {
    const settings = makeCaptureSettings()
    expect(resolveModelPush(settings, remote, false)).toEqual(
      resolveModelPush(settings, null, false),
    )
  })

  it('byok: vendors without presets yield empty chains for empty picks', () => {
    const settings = makeCaptureSettings({
      activeVendor: 'openai-compatible',
      semanticVideoModel: '',
      semanticSnapshotModel: 'my-local-model',
      patternDetectionModel: '',
    })

    const r = resolveModelPush(settings, null, false)

    expect(r.videoModels).toEqual([])
    expect(r.snapshotModels).toEqual(['my-local-model'])
    expect(r.minerModel).toBe('')
  })
})

describe('pushModelSelections', () => {
  it('applies the resolved values to every service', () => {
    const semanticService = { updateModels: vi.fn() }
    const taskMiner = { updateModel: vi.fn(), updateClusterModel: vi.fn() }
    const userContextBuilder = { updateModel: vi.fn() }

    pushModelSelections(
      { semanticService, taskMiner, userContextBuilder },
      makeCaptureSettings(),
      remote,
      true,
    )

    expect(semanticService.updateModels).toHaveBeenCalledWith(
      ['remote/video-a', 'remote/video-b'],
      ['remote/snapshot'],
    )
    expect(taskMiner.updateModel).toHaveBeenCalledWith('remote/miner')
    expect(taskMiner.updateClusterModel).toHaveBeenCalledWith('remote/cluster')
    expect(userContextBuilder.updateModel).toHaveBeenCalledWith('remote/context')
  })
})

describe('hasRequiredSemanticModels', () => {
  const settings = makeCaptureSettings()
  const resolve = (models: RemoteModelConfig['models']) =>
    resolveModelPush(settings, { version: 1, models }, true)
  const videoOnly = resolve({ semanticVideo: ['remote/video'] })
  const snapshotOnly = resolve({ semanticSnapshot: ['remote/snapshot'] })

  it('auto and image require the snapshot chain', () => {
    expect(hasRequiredSemanticModels(snapshotOnly, 'auto')).toBe(true)
    expect(hasRequiredSemanticModels(snapshotOnly, 'image')).toBe(true)
    expect(hasRequiredSemanticModels(videoOnly, 'auto')).toBe(false)
    expect(hasRequiredSemanticModels(videoOnly, 'image')).toBe(false)
  })

  it('video mode requires the video chain', () => {
    expect(hasRequiredSemanticModels(videoOnly, 'video')).toBe(true)
    expect(hasRequiredSemanticModels(snapshotOnly, 'video')).toBe(false)
  })

  it('empty slots are never ready, but a missing config resolves to ready defaults', () => {
    expect(hasRequiredSemanticModels(resolve({}), 'auto')).toBe(false)
    expect(hasRequiredSemanticModels(resolve({}), 'video')).toBe(false)
    expect(hasRequiredSemanticModels(resolveModelPush(settings, null, true), 'auto')).toBe(true)
  })
})
