import type { AppSettings } from '@types'

export type NumericCaptureSetting = Exclude<
  keyof AppSettings,
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
