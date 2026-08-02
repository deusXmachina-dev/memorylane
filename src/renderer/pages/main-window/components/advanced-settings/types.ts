import type { CaptureSettings } from '@types'

export type NumericCaptureSetting = Exclude<
  keyof CaptureSettings,
  | 'autoStartEnabled'
  | 'semanticPipelineMode'
  | 'captureHotkeyAccelerator'
  | 'excludePrivateBrowsing'
  | 'excludeLoginScreens'
  | 'excludedApps'
  | 'excludedUrlPatterns'
  | 'urlMatchSchemaVersion'
  | 'semanticVideoModel'
  | 'semanticSnapshotModel'
  | 'patternDetectionModel'
>
