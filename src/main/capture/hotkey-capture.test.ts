import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAPTURE_HOTKEY_ACCELERATOR,
  formatCaptureHotkeyLabel,
  normalizeCaptureHotkeyAccelerator,
} from './hotkey-capture'

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
  it('maps CommandOrControl to Cmd on mac and Ctrl on windows', () => {
    expect(formatCaptureHotkeyLabel('darwin', 'CommandOrControl+Shift+M')).toBe('Cmd+Shift+M')
    expect(formatCaptureHotkeyLabel('win32', 'CommandOrControl+Shift+M')).toBe('Ctrl+Shift+M')
  })

  it('maps Alt/Option tokens by platform', () => {
    expect(formatCaptureHotkeyLabel('darwin', 'CommandOrControl+Alt+P')).toBe('Cmd+Option+P')
    expect(formatCaptureHotkeyLabel('win32', 'CommandOrControl+Option+P')).toBe('Ctrl+Alt+P')
  })

  it('maps Meta/Super tokens by platform', () => {
    expect(formatCaptureHotkeyLabel('darwin', 'Meta+M')).toBe('Cmd+M')
    expect(formatCaptureHotkeyLabel('win32', 'Super+M')).toBe('Win+M')
  })

  it('normalizes casing for single-key tokens', () => {
    expect(formatCaptureHotkeyLabel('darwin', 'commandorcontrol+shift+m')).toBe('Cmd+Shift+M')
  })
})
