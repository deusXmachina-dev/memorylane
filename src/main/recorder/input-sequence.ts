import { UiohookKey, type UiohookKeyboardEvent, type UiohookMouseEvent } from 'uiohook-napi'
import type { ClickClass, InputRun, KeyClass } from '../../shared/types'

const MOUSE_BUTTON_RIGHT = 2
const MOUSE_BUTTON_MIDDLE = 3
export const DRAG_MIN_DISTANCE_PX = 10

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

export function classifyClick(
  event: Pick<UiohookMouseEvent, 'button' | 'clicks' | 'metaKey' | 'ctrlKey'>,
  platform: NodeJS.Platform = process.platform,
): ClickClass | null {
  if (event.button === MOUSE_BUTTON_RIGHT || (platform === 'darwin' && event.ctrlKey)) {
    return 'right'
  }
  if (event.button === MOUSE_BUTTON_MIDDLE) return 'middle'
  if (event.metaKey || event.ctrlKey) return 'mod'
  if (event.clicks === 2) return 'double'
  if (event.clicks > 2) return null
  return 'left'
}

export function isDrag(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= DRAG_MIN_DISTANCE_PX
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
