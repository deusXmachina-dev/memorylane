import type { CaptureSettings } from '@types'

export type NumericCaptureSetting = Exclude<
  keyof CaptureSettings,
  | 'autoStartEnabled'
  | 'semanticPipelineMode'
  | 'captureHotkeyAccelerator'
  | 'excludePrivateBrowsing'
  | 'excludedApps'
  | 'excludedWindowTitlePatterns'
  | 'excludedUrlPatterns'
  | 'semanticVideoModel'
  | 'semanticSnapshotModel'
  | 'patternDetectionModel'
>
