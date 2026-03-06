const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Shift', 'Alt'])

export type HotkeyPlatform = 'mac' | 'windows' | 'linux' | 'other'

export function detectHotkeyPlatform(): HotkeyPlatform {
  const platform = navigator.userAgentData?.platform ?? navigator.platform ?? ''
  const normalized = platform.toLowerCase()
  if (normalized.includes('mac')) return 'mac'
  if (normalized.includes('win')) return 'windows'
  if (normalized.includes('linux')) return 'linux'
  return 'other'
}

export function formatHotkeyForDisplay(accelerator: string, platform: HotkeyPlatform): string {
  return accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const normalized = part.toLowerCase()

      if (normalized === 'commandorcontrol' || normalized === 'cmdorctrl') {
        return platform === 'mac' ? 'Cmd' : 'Ctrl'
      }
      if (normalized === 'command' || normalized === 'cmd') {
        return 'Cmd'
      }
      if (normalized === 'control' || normalized === 'ctrl') {
        return 'Ctrl'
      }
      if (normalized === 'shift') {
        return 'Shift'
      }
      if (normalized === 'alt' || normalized === 'option') {
        return platform === 'mac' ? 'Option' : 'Alt'
      }
      if (normalized === 'super' || normalized === 'meta') {
        return platform === 'mac' ? 'Cmd' : 'Win'
      }
      if (part.length === 1) {
        return part.toUpperCase()
      }
      return part
    })
    .join('+')
}

export function toRecordedAccelerator(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null

  const key = toAcceleratorKey(event)
  if (!key) return null

  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) {
    parts.push('CommandOrControl')
  }
  if (event.altKey) {
    parts.push('Alt')
  }
  if (event.shiftKey) {
    parts.push('Shift')
  }

  if (parts.length === 0) return null
  return [...parts, key].join('+')
}

function toAcceleratorKey(event: KeyboardEvent): string | null {
  if (event.code.startsWith('Key')) {
    return event.code.slice(3).toUpperCase()
  }

  if (event.code.startsWith('Digit')) {
    return event.code.slice(5)
  }

  const key = event.key
  if (/^F\d{1,2}$/i.test(key)) {
    return key.toUpperCase()
  }

  switch (key) {
    case 'Enter':
      return 'Enter'
    case 'Tab':
      return 'Tab'
    case 'Escape':
      return 'Escape'
    case 'Backspace':
      return 'Backspace'
    case 'Delete':
      return 'Delete'
    case 'ArrowUp':
      return 'Up'
    case 'ArrowDown':
      return 'Down'
    case 'ArrowLeft':
      return 'Left'
    case 'ArrowRight':
      return 'Right'
    case ' ':
      return 'Space'
    default:
      return null
  }
}
