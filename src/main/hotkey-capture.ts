export interface CaptureHotkeyConfig {
  accelerator: string
  label: string
}

export const DEFAULT_CAPTURE_HOTKEY_ACCELERATOR = 'CommandOrControl+Shift+M'

export function normalizeCaptureHotkeyAccelerator(value: string | null | undefined): string {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : DEFAULT_CAPTURE_HOTKEY_ACCELERATOR
}

export function formatCaptureHotkeyLabel(platform: NodeJS.Platform, accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => {
      if (part === 'CommandOrControl') {
        return platform === 'darwin' ? 'Cmd' : 'Ctrl'
      }
      return part
    })
    .join('+')
}

export function getCaptureHotkeyConfig(platform: NodeJS.Platform): CaptureHotkeyConfig {
  return {
    accelerator: DEFAULT_CAPTURE_HOTKEY_ACCELERATOR,
    label: formatCaptureHotkeyLabel(platform, DEFAULT_CAPTURE_HOTKEY_ACCELERATOR),
  }
}
