import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PAUSE_HOTKEY_ACCELERATOR,
  formatPauseHotkeyLabel,
  getPauseHotkeyConfig,
  normalizePauseHotkeyAccelerator,
} from './hotkey-pause'

describe('getPauseHotkeyConfig', () => {
  it('returns a mac-specific shortcut', () => {
    expect(getPauseHotkeyConfig('darwin')).toEqual({
      accelerator: DEFAULT_PAUSE_HOTKEY_ACCELERATOR,
      label: 'Cmd+Shift+M',
    })
  })

  it('returns a windows/linux shortcut', () => {
    expect(getPauseHotkeyConfig('win32')).toEqual({
      accelerator: DEFAULT_PAUSE_HOTKEY_ACCELERATOR,
      label: 'Ctrl+Shift+M',
    })
  })
})

describe('normalizePauseHotkeyAccelerator', () => {
  it('falls back to the default shortcut when empty', () => {
    expect(normalizePauseHotkeyAccelerator('  ')).toBe(DEFAULT_PAUSE_HOTKEY_ACCELERATOR)
  })

  it('trims custom accelerators', () => {
    expect(normalizePauseHotkeyAccelerator(' CommandOrControl+Alt+P ')).toBe(
      'CommandOrControl+Alt+P',
    )
  })
})

describe('formatPauseHotkeyLabel', () => {
  it('maps CommandOrControl to Cmd on mac', () => {
    expect(formatPauseHotkeyLabel('darwin', 'CommandOrControl+Shift+M')).toBe('Cmd+Shift+M')
  })

  it('maps CommandOrControl to Ctrl on windows', () => {
    expect(formatPauseHotkeyLabel('win32', 'CommandOrControl+Shift+M')).toBe('Ctrl+Shift+M')
  })
})
