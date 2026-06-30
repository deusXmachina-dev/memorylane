export const DEFAULT_CAPTURE_HOTKEY_ACCELERATOR = 'CommandOrControl+Shift+M'

export function normalizeCaptureHotkeyAccelerator(value: string | null | undefined): string {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : DEFAULT_CAPTURE_HOTKEY_ACCELERATOR
}

export function formatCaptureHotkeyLabel(platform: NodeJS.Platform, accelerator: string): string {
  const isMac = platform === 'darwin'

  return accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const normalized = part.toLowerCase()

      if (normalized === 'commandorcontrol' || normalized === 'cmdorctrl') {
        return isMac ? 'Cmd' : 'Ctrl'
      }
      if (normalized === 'command' || normalized === 'cmd') return 'Cmd'
      if (normalized === 'control' || normalized === 'ctrl') return 'Ctrl'
      if (normalized === 'shift') return 'Shift'
      if (normalized === 'alt' || normalized === 'option') return isMac ? 'Option' : 'Alt'
      if (normalized === 'super' || normalized === 'meta') return isMac ? 'Cmd' : 'Win'
      if (part.length === 1) return part.toUpperCase()
      return part
    })
    .join('+')
}
