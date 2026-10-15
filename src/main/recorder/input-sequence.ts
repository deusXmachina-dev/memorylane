import { UiohookKey, type UiohookKeyboardEvent, type UiohookMouseEvent } from 'uiohook-napi'
import type { ClickClass, InputRun, KeyClass } from '@types'

const MOUSE_BUTTON_LEFT = 1
const MOUSE_BUTTON_RIGHT = 2

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

const ENTER_KEYCODES = new Set<number>([UiohookKey.Enter, UiohookKey.NumpadEnter])
const DELETE_KEYCODES = new Set<number>([
  UiohookKey.Backspace,
  UiohookKey.Delete,
  UiohookKey.NumpadDelete,
])

const MOD_SHORTCUTS = new Map<number, KeyClass>([
  [UiohookKey.Enter, 'mod+enter'],
  [UiohookKey.NumpadEnter, 'mod+enter'],
  [UiohookKey.C, 'copy'],
  [UiohookKey.X, 'cut'],
  [UiohookKey.V, 'paste'],
  [UiohookKey.Z, 'undo'],
  [UiohookKey.S, 'save'],
])

export function classifyKey(
  event: Pick<UiohookKeyboardEvent, 'keycode' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  platform: NodeJS.Platform = process.platform,
): KeyClass | null {
  if (MODIFIER_KEYCODES.has(event.keycode)) return null
  const mod = platform === 'darwin' ? event.metaKey : event.ctrlKey && !event.altKey
  if (mod && !event.shiftKey) {
    const shortcut = MOD_SHORTCUTS.get(event.keycode)
    if (shortcut) return shortcut
  }
  if (ENTER_KEYCODES.has(event.keycode)) return event.shiftKey ? 'type' : 'enter'
  if (DELETE_KEYCODES.has(event.keycode)) return 'delete'
  if (event.keycode === UiohookKey.Tab) return 'tab'
  if (event.keycode === UiohookKey.Escape) return 'escape'
  return 'type'
}

export function classifyClick(
  event: Pick<UiohookMouseEvent, 'button' | 'clicks' | 'ctrlKey'>,
  platform: NodeJS.Platform = process.platform,
): ClickClass | null {
  if (event.button === MOUSE_BUTTON_RIGHT || (platform === 'darwin' && event.ctrlKey)) {
    return 'right'
  }
  if (event.button !== MOUSE_BUTTON_LEFT || event.clicks > 2) return null
  return event.clicks === 2 ? 'double' : 'left'
}

export function appendRun<T extends string>(sequence: InputRun<T>[], kind: T): void {
  const last = sequence[sequence.length - 1]
  if (last?.kind === kind) {
    last.count++
  } else {
    sequence.push({ kind, count: 1 })
  }
}

export function appendClick(sequence: InputRun<ClickClass>[], kind: ClickClass): void {
  if (kind === 'double') {
    const last = sequence[sequence.length - 1]
    if (last?.kind === 'left') {
      last.count--
      if (last.count === 0) sequence.pop()
    }
  }
  appendRun(sequence, kind)
}
