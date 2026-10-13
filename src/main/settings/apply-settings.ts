import type { AppSettings, SemanticPipelineMode } from '@types'
import type { CaptureExclusions } from '@main/activity/pipeline-harness'

export interface LiveSettingsTargets {
  harness: {
    updateActivityWindowConfig(input: {
      minActivityDurationMs: number
      maxActivityDurationMs: number
    }): void
    updateExclusions(exclusions: CaptureExclusions): void
  }
  semanticService: {
    updatePipelinePreference(mode: SemanticPipelineMode): void
    updateRequestTimeoutMs(ms: number): void
    testConnection(): Promise<void>
  }
  inferenceProvider: { notifyConfigChanged(): void }
  taskMiner: { setEnabled(enabled: boolean): void }
  databaseExport: { exportNow(reason: string): Promise<void> }
  applyModels(): void
}

const MODEL_KEYS = [
  'activeVendor',
  'semanticVideoModel',
  'semanticSnapshotModel',
  'patternDetectionModel',
] as const

export function applySettingsChange(
  t: LiveSettingsTargets,
  next: AppSettings,
  previous: AppSettings,
): void {
  t.harness.updateActivityWindowConfig({
    minActivityDurationMs: next.minActivityDurationMs,
    maxActivityDurationMs: next.maxActivityDurationMs,
  })
  t.harness.updateExclusions({
    apps: next.excludedApps,
    urlPatterns: next.excludedUrlPatterns,
    excludePrivateBrowsing: next.excludePrivateBrowsing,
    excludeLoginScreens: next.excludeLoginScreens,
  })
  t.semanticService.updatePipelinePreference(next.semanticPipelineMode)
  t.semanticService.updateRequestTimeoutMs(next.activityRequestTimeoutMs)
  if (next.patternDetectionEnabled !== previous.patternDetectionEnabled) {
    t.taskMiner.setEnabled(next.patternDetectionEnabled)
  }
  if (next.databaseExportDirectory !== previous.databaseExportDirectory) {
    void t.databaseExport.exportNow('directory changed')
  }
  if (MODEL_KEYS.some((key) => next[key] !== previous[key])) {
    t.applyModels()
  }
  if (next.activeVendor !== previous.activeVendor) {
    t.inferenceProvider.notifyConfigChanged()
    void t.semanticService.testConnection()
  }
}
