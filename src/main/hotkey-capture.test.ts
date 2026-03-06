import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAPTURE_HOTKEY_ACCELERATOR,
  formatCaptureHotkeyLabel,
  getCaptureHotkeyConfig,
  normalizeCaptureHotkeyAccelerator,
} from './hotkey-capture'

describe('getCaptureHotkeyConfig', () => {
  it('returns a mac-specific shortcut', () => {
    expect(getCaptureHotkeyConfig('darwin')).toEqual({
      accelerator: DEFAULT_CAPTURE_HOTKEY_ACCELERATOR,
      label: 'Cmd+Shift+M',
    })
  })

  it('returns a windows/linux shortcut', () => {
    expect(getCaptureHotkeyConfig('win32')).toEqual({
      accelerator: DEFAULT_CAPTURE_HOTKEY_ACCELERATOR,
      label: 'Ctrl+Shift+M',
    })
  })
})

describe('normalizeCaptureHotkeyAccelerator', () => {
  it('falls back to the default shortcut when empty', () => {
    expect(normalizeCaptureHotkeyAccelerator('  ')).toBe(DEFAULT_CAPTURE_HOTKEY_ACCELERATOR)
  })

  it('trims custom accelerators', () => {
    expect(normalizeCaptureHotkeyAccelerator(' CommandOrControl+Alt+P ')).toBe(
      'CommandOrControl+Alt+P',
    )
  })
})

describe('formatCaptureHotkeyLabel', () => {
  it('maps CommandOrControl to Cmd on mac', () => {
    expect(formatCaptureHotkeyLabel('darwin', 'CommandOrControl+Shift+M')).toBe('Cmd+Shift+M')
  })

  it('maps CommandOrControl to Ctrl on windows', () => {
    expect(formatCaptureHotkeyLabel('win32', 'CommandOrControl+Shift+M')).toBe('Ctrl+Shift+M')
  })
})
