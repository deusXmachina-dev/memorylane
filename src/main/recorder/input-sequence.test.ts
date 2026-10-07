import { describe, expect, it } from 'vitest'
import { UiohookKey } from 'uiohook-napi'
import type { ClickClass, InputRun, KeyClass } from '../../shared/types'
import { appendClick, appendRun, classifyClick, classifyKey, isDrag } from './input-sequence'

function press(keycode: number, mods: { meta?: boolean; ctrl?: boolean; shift?: boolean } = {}) {
  return classifyKey({
    keycode,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
  })
}

describe('classifyKey', () => {
  it('reduces printable keys to an anonymous char class', () => {
    expect(press(UiohookKey.Q)).toBe('char')
    expect(press(UiohookKey.Space)).toBe('char')
    expect(press(UiohookKey.Q, { shift: true })).toBe('char')
  })

  it('names submit, edit and navigation-in-form keys', () => {
    expect(press(UiohookKey.Enter)).toBe('enter')
    expect(press(UiohookKey.NumpadEnter)).toBe('enter')
    expect(press(UiohookKey.Enter, { shift: true })).toBe('shift+enter')
    expect(press(UiohookKey.Backspace)).toBe('delete')
    expect(press(UiohookKey.Tab)).toBe('tab')
    expect(press(UiohookKey.Escape)).toBe('escape')
  })

  it('maps Cmd and Ctrl shortcuts alike and buckets unknown ones', () => {
    expect(press(UiohookKey.S, { meta: true })).toBe('mod+s')
    expect(press(UiohookKey.S, { ctrl: true })).toBe('mod+s')
    expect(press(UiohookKey.Enter, { meta: true })).toBe('mod+enter')
    expect(press(UiohookKey.K, { meta: true })).toBe('shortcut')
  })

  it('ignores lone modifiers and cursor movement', () => {
    expect(press(UiohookKey.Meta, { meta: true })).toBeNull()
    expect(press(UiohookKey.Shift, { shift: true })).toBeNull()
    expect(press(UiohookKey.ArrowDown)).toBeNull()
  })
})

describe('appendRun', () => {
  it('run-length encodes while keeping order', () => {
    const sequence: InputRun<KeyClass>[] = []
    for (const key of ['char', 'char', 'enter', 'char', 'char', 'char'] as const) {
      appendRun(sequence, key)
    }
    expect(sequence).toEqual([
      { kind: 'char', count: 2 },
      { kind: 'enter', count: 1 },
      { kind: 'char', count: 3 },
    ])
  })
})

function click(
  button: number,
  clicks = 1,
  mods: { meta?: boolean; ctrl?: boolean } = {},
  platform: NodeJS.Platform = 'darwin',
) {
  return classifyClick(
    { button, clicks, metaKey: mods.meta ?? false, ctrlKey: mods.ctrl ?? false },
    platform,
  )
}

describe('classifyClick', () => {
  it('distinguishes buttons and multi-clicks', () => {
    expect(click(1)).toBe('left')
    expect(click(2)).toBe('right')
    expect(click(3)).toBe('middle')
    expect(click(1, 2)).toBe('double')
    expect(click(1, 3)).toBeNull()
  })

  it('treats Ctrl-click as a right-click on macOS only', () => {
    expect(click(1, 1, { ctrl: true }, 'darwin')).toBe('right')
    expect(click(1, 1, { ctrl: true }, 'win32')).toBe('mod')
    expect(click(1, 1, { meta: true }, 'darwin')).toBe('mod')
  })
})

describe('appendClick', () => {
  it('folds the first click of a double-click into it', () => {
    const sequence: InputRun<ClickClass>[] = []
    for (const kind of ['left', 'left', 'double', 'right'] as const) {
      appendClick(sequence, kind)
    }
    expect(sequence).toEqual([
      { kind: 'left', count: 1 },
      { kind: 'double', count: 1 },
      { kind: 'right', count: 1 },
    ])
  })
})

describe('isDrag', () => {
  it('requires the pointer to move a few pixels', () => {
    expect(isDrag({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(false)
    expect(isDrag({ x: 0, y: 0 }, { x: 30, y: 40 })).toBe(true)
  })
})
