import type { CaptureSettings } from '../../shared/types'
import { VENDOR_PRESETS } from '../../shared/vendor-defaults'

export function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response
}

export function makeCaptureSettings(overrides: Partial<CaptureSettings> = {}): CaptureSettings {
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
    semanticPipelineMode: 'auto',
    captureHotkeyAccelerator: 'CommandOrControl+Shift+M',
    databaseExportDirectory: '',
    excludePrivateBrowsing: true,
    excludedApps: [],
    excludedUrlPatterns: [],
    activeVendor: 'openrouter',
    modelsByVendor: {},
    semanticVideoModel: VENDOR_PRESETS.openrouter.semanticVideo[0].id,
    semanticSnapshotModel: VENDOR_PRESETS.openrouter.semanticSnapshot[0].id,
    patternDetectionModel: VENDOR_PRESETS.openrouter.patternDetection[0].id,
    patternDetectionEnabled: true,
    uploadDetailLevel: 'off',
    ...overrides,
  }
}
