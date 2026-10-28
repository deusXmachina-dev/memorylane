import type { AppSettings } from '../../shared/types'
import { VENDOR_PRESETS } from '../../shared/vendor-defaults'

export async function readFormFile(
  body: BodyInit | null,
  field = 'file',
): Promise<{ name: string; bytes: Buffer }> {
  if (body === null) throw new Error('expected a request body')
  const file = (body as FormData).get(field) as File
  return { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }
}

export function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response
}

export function makeAppSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    autoStartEnabled: true,
    visualThreshold: 8,
    typingDebounceMs: 2000,
    scrollDebounceMs: 2000,
    clickDebounceMs: 3000,
    minActivityDurationMs: 3000,
    maxActivityDurationMs: 300000,
    maxScreenshotsForLlm: 6,
    activityRequestTimeoutMs: 120000,
    taskMiningRequestTimeoutMs: 1200000,
    semanticPipelineMode: 'auto',
    captureHotkeyAccelerator: 'CommandOrControl+Shift+M',
    excludePrivateBrowsing: true,
    excludeLoginScreens: true,
    excludedApps: [],
    excludedUrlPatterns: [],
    activeVendor: 'openrouter',
    modelsByVendor: {},
    semanticVideoModel: VENDOR_PRESETS.openrouter.semanticVideo[0].id,
    semanticSnapshotModel: VENDOR_PRESETS.openrouter.semanticSnapshot[0].id,
    patternDetectionModel: VENDOR_PRESETS.openrouter.patternDetection[0].id,
    patternDetectionEnabled: true,
    remoteSyncEnabled: false,
    ...overrides,
  }
}
