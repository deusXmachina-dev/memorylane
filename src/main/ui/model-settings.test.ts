import { describe, it, expect, vi } from 'vitest'
import { applyModelSettings, type ModelSettingsDeps } from './model-settings'
import type { CaptureSettings } from '../../shared/types'
import { VENDOR_PRESETS } from '../../shared/vendor-defaults'

function makeDeps(): {
  deps: ModelSettingsDeps
  semanticService: { updateModels: ReturnType<typeof vi.fn> }
  patternDetector: {
    updateModel: ReturnType<typeof vi.fn>
    setEnabled: ReturnType<typeof vi.fn>
  }
  userContextBuilder: { updateModel: ReturnType<typeof vi.fn> }
} {
  const semanticService = { updateModels: vi.fn() }
  const patternDetector = { updateModel: vi.fn(), setEnabled: vi.fn() }
  const userContextBuilder = { updateModel: vi.fn() }
  const deps: ModelSettingsDeps = { semanticService, patternDetector, userContextBuilder }
  return { deps, semanticService, patternDetector, userContextBuilder }
}

function makeSettings(overrides: Partial<CaptureSettings> = {}): CaptureSettings {
  return {
    autoStartEnabled: true,
    visualThreshold: 8,
    typingDebounceMs: 2000,
    scrollDebounceMs: 2000,
    clickDebounceMs: 3000,
    minActivityDurationMs: 3000,
    maxActivityDurationMs: 300000,
    maxScreenshotsForLlm: 6,
    semanticRequestTimeoutMs: 120000,
    semanticPipelineMode: 'image',
    captureHotkeyAccelerator: 'CommandOrControl+Shift+M',
    databaseExportDirectory: '',
    excludePrivateBrowsing: true,
    excludedApps: [],
    excludedUrlPatterns: [],
    activeVendor: 'openrouter',
    modelsByVendor: {},
    newTaskMinerEnabled: true,
    semanticVideoModel: VENDOR_PRESETS.openrouter.semanticVideo[0].id,
    semanticSnapshotModel: VENDOR_PRESETS.openrouter.semanticSnapshot[0].id,
    patternDetectionModel: VENDOR_PRESETS.openrouter.patternDetection[0].id,
    patternDetectionEnabled: true,
    uploadDetailLevel: 'off',
    ...overrides,
  }
}

describe('applyModelSettings', () => {
  it('propagates a changed patternDetectionModel to both patternDetector and userContextBuilder', () => {
    const { deps, patternDetector, userContextBuilder } = makeDeps()
    const previous = makeSettings({ patternDetectionModel: 'old/model' })
    const updated = makeSettings({ patternDetectionModel: 'new/model' })

    applyModelSettings(deps, updated, previous)

    expect(patternDetector.updateModel).toHaveBeenCalledWith('new/model')
    expect(userContextBuilder.updateModel).toHaveBeenCalledWith('new/model')
  })

  it('does not call updateModel when patternDetectionModel is unchanged', () => {
    const { deps, patternDetector, userContextBuilder } = makeDeps()
    const settings = makeSettings({ patternDetectionModel: 'same/model' })

    applyModelSettings(deps, settings, settings)

    expect(patternDetector.updateModel).not.toHaveBeenCalled()
    expect(userContextBuilder.updateModel).not.toHaveBeenCalled()
  })

  it('skips both updateModel calls without throwing when optional services are absent', () => {
    const semanticService = { updateModels: vi.fn() }
    const deps: ModelSettingsDeps = { semanticService }
    const previous = makeSettings({ patternDetectionModel: 'old/model' })
    const updated = makeSettings({ patternDetectionModel: 'new/model' })

    expect(() => applyModelSettings(deps, updated, previous)).not.toThrow()
  })

  it('forwards setEnabled to patternDetector when patternDetectionEnabled flips', () => {
    const { deps, patternDetector, userContextBuilder } = makeDeps()
    const previous = makeSettings({ patternDetectionEnabled: true })
    const updated = makeSettings({ patternDetectionEnabled: false })

    applyModelSettings(deps, updated, previous)

    expect(patternDetector.setEnabled).toHaveBeenCalledWith(false)
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

  it('uses remote chains for the tail and diverges the user-context model', () => {
    const { deps, semanticService, patternDetector, userContextBuilder } = makeDeps()
    deps.getRemoteModelConfig = () => ({
      version: 2,
      models: {
        semanticVideo: ['remote/video-a', 'remote/video-b'],
        userContext: ['remote/context-model'],
      },
    })
    const previous = makeSettings({
      semanticVideoModel: 'remote/video-a',
      patternDetectionModel: 'old/model',
    })
    const updated = makeSettings({
      semanticVideoModel: 'remote/video-b',
      patternDetectionModel: 'new/model',
    })

    applyModelSettings(deps, updated, previous)

    const [videoModels] = semanticService.updateModels.mock.calls[0] as [string[], string[]]
    expect(videoModels).toEqual(['remote/video-b', 'remote/video-a'])
    expect(patternDetector.updateModel).toHaveBeenCalledWith('new/model')
    expect(userContextBuilder.updateModel).toHaveBeenCalledWith('remote/context-model')
  })
})
