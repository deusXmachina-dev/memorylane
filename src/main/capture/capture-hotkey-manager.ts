import { globalShortcut } from 'electron'
import {
  DEFAULT_CAPTURE_HOTKEY_ACCELERATOR,
  formatCaptureHotkeyLabel,
  normalizeCaptureHotkeyAccelerator,
} from './hotkey-capture'

export interface CaptureHotkeyManager {
  getAccelerator: () => string
  getLabel: () => string
  reconfigure: (accelerator: string) => { success: boolean; error?: string }
}

type CreateCaptureHotkeyManagerOptions = {
  platform: NodeJS.Platform
  onTriggered: (accelerator: string) => void
}

export function createCaptureHotkeyManager({
  platform,
  onTriggered,
}: CreateCaptureHotkeyManagerOptions): CaptureHotkeyManager {
  let registered = false
  let accelerator = DEFAULT_CAPTURE_HOTKEY_ACCELERATOR

  const handleHotkeyTrigger = (): void => {
    onTriggered(accelerator)
  }

  const reconfigure = (nextAccelerator: string): { success: boolean; error?: string } => {
    const previousAccelerator = accelerator
    const previousRegistered = registered
    const normalizedAccelerator = normalizeCaptureHotkeyAccelerator(nextAccelerator)

    if (previousRegistered) {
      globalShortcut.unregister(previousAccelerator)
      registered = false
    }

    try {
      registered = globalShortcut.register(normalizedAccelerator, handleHotkeyTrigger)
    } catch (error) {
      registered = false
      if (previousRegistered) {
        registered = globalShortcut.register(previousAccelerator, handleHotkeyTrigger)
      }
      const message = error instanceof Error ? error.message : 'Invalid shortcut'
      return { success: false, error: `Failed to register start/stop shortcut: ${message}` }
    }

    if (!registered) {
      if (previousRegistered) {
        registered = globalShortcut.register(previousAccelerator, handleHotkeyTrigger)
      }
      return {
        success: false,
        error: 'Failed to register start/stop shortcut. Shortcut may be in use.',
      }
    }

    accelerator = normalizedAccelerator
    return { success: true }
  }

  return {
    getAccelerator: () => accelerator,
    getLabel: () => (registered ? formatCaptureHotkeyLabel(platform, accelerator) : ''),
    reconfigure,
  }
}
