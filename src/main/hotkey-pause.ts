export interface PauseHotkeyConfig {
  accelerator: string
  label: string
}

export const DEFAULT_PAUSE_HOTKEY_ACCELERATOR = 'CommandOrControl+Shift+M'

export function normalizePauseHotkeyAccelerator(value: string | null | undefined): string {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : DEFAULT_PAUSE_HOTKEY_ACCELERATOR
}

export function formatPauseHotkeyLabel(platform: NodeJS.Platform, accelerator: string): string {
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

export function getPauseHotkeyConfig(platform: NodeJS.Platform): PauseHotkeyConfig {
  return {
    accelerator: DEFAULT_PAUSE_HOTKEY_ACCELERATOR,
    label: formatPauseHotkeyLabel(platform, DEFAULT_PAUSE_HOTKEY_ACCELERATOR),
  }
}
