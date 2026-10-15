import { describe, expect, it } from 'vitest'
import { UiohookKey } from 'uiohook-napi'
import type { ClickClass, InputRun, KeyClass } from '@types'
import { appendClick, appendRun, classifyClick, classifyKey } from '@main/recorder/input-sequence'

type Mods = { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean }

function press(keycode: number, mods: Mods = {}, platform: NodeJS.Platform = 'darwin') {
  return classifyKey(
    {
      keycode,
      metaKey: mods.meta ?? false,
      ctrlKey: mods.ctrl ?? false,
      altKey: mods.alt ?? false,
      shiftKey: mods.shift ?? false,
    },
    platform,
  )
}

describe('classifyKey', () => {
  it('reduces printable keys to an anonymous type class', () => {
    expect(press(UiohookKey.Q)).toBe('type')
    expect(press(UiohookKey.Space)).toBe('type')
    expect(press(UiohookKey.Q, { shift: true })).toBe('type')
    expect(press(UiohookKey.Q, { alt: true })).toBe('type')
    expect(press(UiohookKey.Enter, { shift: true })).toBe('type')
  })

  it('names submit, cancel, delete and field keys', () => {
    expect(press(UiohookKey.Enter)).toBe('enter')
    expect(press(UiohookKey.NumpadEnter)).toBe('enter')
    expect(press(UiohookKey.Backspace)).toBe('delete')
    expect(press(UiohookKey.Tab)).toBe('tab')
    expect(press(UiohookKey.Escape)).toBe('escape')
  })

  it('names clipboard, undo, save and send shortcuts', () => {
    expect(press(UiohookKey.C, { meta: true })).toBe('copy')
    expect(press(UiohookKey.X, { meta: true })).toBe('cut')
    expect(press(UiohookKey.V, { ctrl: true }, 'win32')).toBe('paste')
    expect(press(UiohookKey.Z, { meta: true })).toBe('undo')
    expect(press(UiohookKey.S, { ctrl: true }, 'win32')).toBe('save')
    expect(press(UiohookKey.Enter, { meta: true })).toBe('mod+enter')
  })

  it('counts every other key as typing', () => {
    expect(press(UiohookKey.K, { meta: true })).toBe('type')
    expect(press(UiohookKey.Z, { meta: true, shift: true })).toBe('type')
    expect(press(UiohookKey.C, { ctrl: true }, 'darwin')).toBe('type')
    expect(press(UiohookKey.ArrowDown)).toBe('type')
    expect(press(UiohookKey.F5)).toBe('type')
  })

  it('treats AltGr on Windows as typing', () => {
    expect(press(UiohookKey.V, { ctrl: true, alt: true }, 'win32')).toBe('type')
  })

  it('ignores lone modifiers', () => {
    expect(press(UiohookKey.Meta, { meta: true })).toBeNull()
    expect(press(UiohookKey.Shift, { shift: true })).toBeNull()
  })
})

describe('appendRun', () => {
  it('run-length encodes while keeping order', () => {
    const sequence: InputRun<KeyClass>[] = []
    for (const key of ['type', 'type', 'enter', 'type', 'type', 'type'] as const) {
      appendRun(sequence, key)
    }
    expect(sequence).toEqual([
      { kind: 'type', count: 2 },
      { kind: 'enter', count: 1 },
      { kind: 'type', count: 3 },
    ])
  })
})

function click(
  button: number,
  clicks = 1,
  mods: { ctrl?: boolean } = {},
  platform: NodeJS.Platform = 'darwin',
) {
  return classifyClick({ button, clicks, ctrlKey: mods.ctrl ?? false }, platform)
}

describe('classifyClick', () => {
  it('distinguishes left, double and right clicks', () => {
    expect(click(1)).toBe('left')
    expect(click(2)).toBe('right')
    expect(click(1, 2)).toBe('double')
    expect(click(1, 3)).toBeNull()
    expect(click(3)).toBeNull()
  })

  it('treats Ctrl-click as a right-click on macOS only', () => {
    expect(click(1, 1, { ctrl: true }, 'darwin')).toBe('right')
    expect(click(1, 1, { ctrl: true }, 'win32')).toBe('left')
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
