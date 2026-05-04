import { describe, it, expect, vi } from 'vitest'
import { applyVendorSwitch, type VendorSwitchDeps } from './vendor-switch'
import type { CaptureSettings, Vendor } from '../../shared/types'
import { VENDOR_PRESETS } from '../../shared/vendor-defaults'

function makeDeps(): {
  deps: VendorSwitchDeps
  semanticService: {
    updateModels: ReturnType<typeof vi.fn>
    updatePipelinePreference: ReturnType<typeof vi.fn>
    testConnection: ReturnType<typeof vi.fn>
  }
  patternDetector: { updateModel: ReturnType<typeof vi.fn> }
  inferenceProvider: { notifyConfigChanged: ReturnType<typeof vi.fn> }
} {
  const semanticService = {
    updateModels: vi.fn(),
    updatePipelinePreference: vi.fn(),
    testConnection: vi.fn().mockResolvedValue(undefined),
  }
  const patternDetector = { updateModel: vi.fn() }
  const inferenceProvider = { notifyConfigChanged: vi.fn() }
  const deps: VendorSwitchDeps = {
    semanticService,
    patternDetector,
    inferenceProvider,
  }
  return { deps, semanticService, patternDetector, inferenceProvider }
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
    excludedWindowTitlePatterns: [],
    excludedUrlPatterns: [],
    activeVendor: 'openrouter',
    semanticVideoModel: '',
    semanticSnapshotModel: '',
    patternDetectionModel: '',
    patternDetectionEnabled: true,
    uploadDetailLevel: 'off',
    ...overrides,
  }
}

describe('applyVendorSwitch', () => {
  it('regression: pushes the new pipeline mode into the SemanticService', () => {
    // Reproduces the bug where switching from openai-compatible to openrouter
    // left the runtime stuck in image-only mode because the IPC handler
    // updated the persisted setting but never called updatePipelinePreference.
    const { deps, semanticService } = makeDeps()
    const next = makeSettings({
      activeVendor: 'openrouter',
      semanticVideoModel: VENDOR_PRESETS.openrouter.semanticVideo[0].id,
      semanticSnapshotModel: VENDOR_PRESETS.openrouter.semanticSnapshot[0].id,
      patternDetectionModel: VENDOR_PRESETS.openrouter.patternDetection[0].id,
      semanticPipelineMode: 'auto',
    })

    applyVendorSwitch(deps, next)

    expect(semanticService.updatePipelinePreference).toHaveBeenCalledTimes(1)
    expect(semanticService.updatePipelinePreference).toHaveBeenCalledWith('auto')
  })

  it('feeds the full fallback chain into updateModels', () => {
    const { deps, semanticService } = makeDeps()
    const userVideoPick = VENDOR_PRESETS.openrouter.semanticVideo[1].id
    const next = makeSettings({
      activeVendor: 'openrouter',
      semanticVideoModel: userVideoPick,
      semanticSnapshotModel: VENDOR_PRESETS.openrouter.semanticSnapshot[0].id,
      semanticPipelineMode: 'auto',
    })

    applyVendorSwitch(deps, next)

    const [videoModels, snapshotModels] = semanticService.updateModels.mock.calls[0] as [
      string[],
      string[],
    ]
    expect(videoModels[0]).toBe(userVideoPick)
    expect(videoModels.length).toBe(VENDOR_PRESETS.openrouter.semanticVideo.length)
    expect(snapshotModels.length).toBeGreaterThan(0)
  })

  it("forces image mode for vendors that don't support video (openai-compatible)", () => {
    const { deps, semanticService } = makeDeps()
    const next = makeSettings({
      activeVendor: 'openai-compatible',
      semanticVideoModel: '',
      semanticSnapshotModel: 'llama3.2:latest',
      patternDetectionModel: 'llama3.2:latest',
      semanticPipelineMode: 'image',
    })

    applyVendorSwitch(deps, next)

    expect(semanticService.updatePipelinePreference).toHaveBeenCalledWith('image')
    const [videoModels] = semanticService.updateModels.mock.calls[0] as [string[], string[]]
    expect(videoModels).toEqual([])
  })

  it('updates the pattern detector model when present and skips when absent', () => {
    const { deps, patternDetector } = makeDeps()
    const next = makeSettings({
      activeVendor: 'openrouter',
      patternDetectionModel: VENDOR_PRESETS.openrouter.patternDetection[0].id,
      semanticPipelineMode: 'auto',
    })

    applyVendorSwitch(deps, next)
    expect(patternDetector.updateModel).toHaveBeenCalledWith(
      VENDOR_PRESETS.openrouter.patternDetection[0].id,
    )

    // No detector → no throw.
    const { deps: bareDeps, semanticService } = makeDeps()
    const depsWithoutDetector: VendorSwitchDeps = {
      semanticService: bareDeps.semanticService,
      inferenceProvider: bareDeps.inferenceProvider,
    }
    expect(() => applyVendorSwitch(depsWithoutDetector, next)).not.toThrow()
    expect(semanticService.updatePipelinePreference).toHaveBeenCalled()
  })

  it('notifies the inference provider after the model/preference push', () => {
    const { deps, semanticService, inferenceProvider } = makeDeps()
    const callOrder: string[] = []
    semanticService.updateModels.mockImplementation(() => callOrder.push('updateModels'))
    semanticService.updatePipelinePreference.mockImplementation(() =>
      callOrder.push('updatePipelinePreference'),
    )
    inferenceProvider.notifyConfigChanged.mockImplementation(() =>
      callOrder.push('notifyConfigChanged'),
    )

    applyVendorSwitch(deps, makeSettings({ activeVendor: 'openrouter' as Vendor }))

    expect(callOrder.indexOf('notifyConfigChanged')).toBeGreaterThan(
      callOrder.indexOf('updatePipelinePreference'),
    )
  })

  it('triggers testConnection so the LLM health check refreshes', () => {
    const { deps, semanticService } = makeDeps()
    applyVendorSwitch(deps, makeSettings({ activeVendor: 'openrouter' }))
    expect(semanticService.testConnection).toHaveBeenCalledTimes(1)
  })
})
