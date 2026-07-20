import { describe, expect, it } from 'vitest'

import type { RemoteModelConfig } from '../../shared/remote-model-config'
import { VENDOR_PRESETS } from '../../shared/vendor-defaults'
import {
  getEffectivePresets,
  resolveClusterModelOverride,
  resolveTextTaskModels,
} from './effective-model-presets'

const REMOTE: RemoteModelConfig = {
  version: 3,
  models: {
    semanticVideo: ['google/gemini-2.5-flash', 'some/new-model'],
    taskMining: ['xiaomi/mimo-v2.5'],
    userContext: ['minimax/minimax-m3'],
  },
}

describe('getEffectivePresets', () => {
  it('returns baked presets when there is no remote config', () => {
    expect(getEffectivePresets('openrouter', null)).toBe(VENDOR_PRESETS.openrouter)
  })

  it('returns baked presets for non-openrouter vendors regardless of remote config', () => {
    expect(getEffectivePresets('google', REMOTE)).toBe(VENDOR_PRESETS.google)
  })

  it('replaces remotely-configured slots and keeps baked labels for known ids', () => {
    const presets = getEffectivePresets('openrouter', REMOTE)
    expect(presets.semanticVideo).toEqual([
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'some/new-model', label: 'some/new-model' },
    ])
    // taskMining maps onto the stored patternDetection slot.
    expect(presets.patternDetection).toEqual([{ id: 'xiaomi/mimo-v2.5', label: 'MiMo V2.5' }])
  })

  it('falls through to baked presets for empty or missing slots', () => {
    const presets = getEffectivePresets('openrouter', REMOTE)
    expect(presets.semanticSnapshot).toBe(VENDOR_PRESETS.openrouter.semanticSnapshot)
  })
})

describe('resolveTextTaskModels', () => {
  it('follows the stored pick for all tasks without remote config', () => {
    expect(resolveTextTaskModels('minimax/minimax-m3', 'openrouter', null)).toEqual({
      taskMining: 'minimax/minimax-m3',
      userContext: 'minimax/minimax-m3',
      clusterReview: 'minimax/minimax-m3',
    })
  })

  it('follows the stored pick for non-openrouter vendors', () => {
    expect(resolveTextTaskModels('gemini-2.5-flash', 'google', REMOTE)).toEqual({
      taskMining: 'gemini-2.5-flash',
      userContext: 'gemini-2.5-flash',
      clusterReview: 'gemini-2.5-flash',
    })
  })

  it('diverges tasks with a remote opinion and defaults the rest to the pick', () => {
    expect(resolveTextTaskModels('xiaomi/mimo-v2.5', 'openrouter', REMOTE)).toEqual({
      taskMining: 'xiaomi/mimo-v2.5',
      userContext: 'minimax/minimax-m3',
      clusterReview: 'xiaomi/mimo-v2.5',
    })
  })
})

describe('resolveClusterModelOverride', () => {
  const WITH_CLUSTER: RemoteModelConfig = {
    version: 1,
    models: { clusterReview: ['remote/cluster-model'] },
  }

  it('returns the remote head for openrouter and null without an opinion', () => {
    expect(resolveClusterModelOverride('openrouter', WITH_CLUSTER)).toBe('remote/cluster-model')
    expect(resolveClusterModelOverride('openrouter', REMOTE)).toBeNull()
    expect(resolveClusterModelOverride('openrouter', null)).toBeNull()
  })

  it('never returns an override for other vendors', () => {
    expect(resolveClusterModelOverride('google', WITH_CLUSTER)).toBeNull()
    expect(resolveClusterModelOverride('openai-compatible', WITH_CLUSTER)).toBeNull()
  })
})
