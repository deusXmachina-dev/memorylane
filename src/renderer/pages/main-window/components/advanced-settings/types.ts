import type { CaptureSettings } from '@types'

export type NumericCaptureSetting = Exclude<
  keyof CaptureSettings,
  | 'autoStartEnabled'
  | 'semanticPipelineMode'
  | 'captureHotkeyAccelerator'
  | 'excludedApps'
  | 'excludedWindowTitlePatterns'
  | 'excludedUrlPatterns'
>
