import { UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'
import type { KeyClass, KeyRun } from '../../shared/types'

const MODIFIER_KEYCODES = new Set<number>([
  UiohookKey.Shift,
  UiohookKey.ShiftRight,
  UiohookKey.Ctrl,
  UiohookKey.CtrlRight,
  UiohookKey.Alt,
  UiohookKey.AltRight,
  UiohookKey.Meta,
  UiohookKey.MetaRight,
  UiohookKey.CapsLock,
])

const NAVIGATION_KEYCODES = new Set<number>([
  UiohookKey.ArrowLeft,
  UiohookKey.ArrowRight,
  UiohookKey.ArrowUp,
  UiohookKey.ArrowDown,
  UiohookKey.Home,
  UiohookKey.End,
  UiohookKey.PageUp,
  UiohookKey.PageDown,
])

const ENTER_KEYCODES = new Set<number>([UiohookKey.Enter, UiohookKey.NumpadEnter])
const DELETE_KEYCODES = new Set<number>([
  UiohookKey.Backspace,
  UiohookKey.Delete,
  UiohookKey.NumpadDelete,
])

const MOD_SHORTCUTS = new Map<number, KeyClass>([
  [UiohookKey.Enter, 'mod+enter'],
  [UiohookKey.NumpadEnter, 'mod+enter'],
  [UiohookKey.S, 'mod+s'],
  [UiohookKey.C, 'mod+c'],
  [UiohookKey.V, 'mod+v'],
  [UiohookKey.X, 'mod+x'],
  [UiohookKey.Z, 'mod+z'],
  [UiohookKey.A, 'mod+a'],
  [UiohookKey.F, 'mod+f'],
])

export function classifyKey(
  event: Pick<UiohookKeyboardEvent, 'keycode' | 'metaKey' | 'ctrlKey' | 'shiftKey'>,
): KeyClass | null {
  if (MODIFIER_KEYCODES.has(event.keycode) || NAVIGATION_KEYCODES.has(event.keycode)) return null
  if (event.metaKey || event.ctrlKey) {
    return MOD_SHORTCUTS.get(event.keycode) ?? 'shortcut'
  }
  if (ENTER_KEYCODES.has(event.keycode)) return event.shiftKey ? 'shift+enter' : 'enter'
  if (DELETE_KEYCODES.has(event.keycode)) return 'delete'
  if (event.keycode === UiohookKey.Tab) return 'tab'
  if (event.keycode === UiohookKey.Escape) return 'escape'
  return 'char'
}

export function appendKey(sequence: KeyRun[], key: KeyClass): void {
  const last = sequence[sequence.length - 1]
  if (last?.key === key) {
    last.count++
  } else {
    sequence.push({ key, count: 1 })
  }
}
