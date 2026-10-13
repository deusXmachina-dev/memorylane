import { describe, expect, it, vi } from 'vitest'
import type { CaptureSettings } from '@types'
import { makeCaptureSettings } from '@main/utils/test-utils'
import { applySettingsChange, type LiveSettingsTargets } from './apply-settings'

function makeTargets() {
  const targets = {
    capture: { updateActivityWindowConfig: vi.fn(), updateExclusions: vi.fn() },
    semanticService: {
      updatePipelinePreference: vi.fn(),
      updateRequestTimeoutMs: vi.fn(),
      testConnection: vi.fn().mockResolvedValue(undefined),
    },
    inferenceProvider: { notifyConfigChanged: vi.fn() },
    taskMiner: { setEnabled: vi.fn() },
    applyModels: vi.fn(),
  } satisfies LiveSettingsTargets
  return targets
}

function makeSettings(overrides: Partial<CaptureSettings> = {}): CaptureSettings {
  return makeCaptureSettings({ semanticPipelineMode: 'image', ...overrides })
}

describe('applySettingsChange', () => {
  it('always pushes capture and pipeline settings', () => {
    const t = makeTargets()
    const settings = makeSettings({ excludedApps: ['signal'], semanticPipelineMode: 'video' })

    applySettingsChange(t, settings, settings)

    expect(t.capture.updateExclusions).toHaveBeenCalledWith(
      expect.objectContaining({ apps: ['signal'] }),
    )
    expect(t.capture.updateActivityWindowConfig).toHaveBeenCalledTimes(1)
    expect(t.semanticService.updatePipelinePreference).toHaveBeenCalledWith('video')
    expect(t.semanticService.updateRequestTimeoutMs).toHaveBeenCalledTimes(1)
  })

  it('applies models only when a model field or the vendor changed', () => {
    const t = makeTargets()
    const settings = makeSettings({ patternDetectionModel: 'a' })

    applySettingsChange(t, settings, settings)
    expect(t.applyModels).not.toHaveBeenCalled()

    applySettingsChange(t, makeSettings({ patternDetectionModel: 'b' }), settings)
    expect(t.applyModels).toHaveBeenCalledTimes(1)
  })

  it('toggles the task miner when patternDetectionEnabled flips', () => {
    const t = makeTargets()

    applySettingsChange(
      t,
      makeSettings({ patternDetectionEnabled: false }),
      makeSettings({ patternDetectionEnabled: true }),
    )

    expect(t.taskMiner.setEnabled).toHaveBeenCalledWith(false)
  })

  it('reconnects the provider on a vendor switch', () => {
    const t = makeTargets()

    applySettingsChange(
      t,
      makeSettings({ activeVendor: 'openai-compatible' }),
      makeSettings({ activeVendor: 'openrouter' }),
    )

    expect(t.applyModels).toHaveBeenCalledTimes(1)
    expect(t.inferenceProvider.notifyConfigChanged).toHaveBeenCalledTimes(1)
    expect(t.semanticService.testConnection).toHaveBeenCalledTimes(1)
  })
})
