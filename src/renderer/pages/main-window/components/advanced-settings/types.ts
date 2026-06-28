import type { CaptureSettings } from '@types'

export type NumericCaptureSetting = Exclude<
  keyof CaptureSettings,
  | 'autoStartEnabled'
  | 'semanticPipelineMode'
  | 'captureHotkeyAccelerator'
  | 'excludePrivateBrowsing'
  | 'excludedApps'
  | 'excludedUrlPatterns'
  | 'urlMatchSchemaVersion'
  | 'semanticVideoModel'
  | 'semanticSnapshotModel'
  | 'patternDetectionModel'
>
