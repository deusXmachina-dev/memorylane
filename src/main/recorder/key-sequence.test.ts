import { describe, expect, it } from 'vitest'
import { UiohookKey } from 'uiohook-napi'
import type { KeyRun } from '../../shared/types'
import { appendKey, classifyKey } from './key-sequence'

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

describe('appendKey', () => {
  it('run-length encodes while keeping order', () => {
    const sequence: KeyRun[] = []
    for (const key of ['char', 'char', 'enter', 'char', 'char', 'char'] as const) {
      appendKey(sequence, key)
    }
    expect(sequence).toEqual([
      { key: 'char', count: 2 },
      { key: 'enter', count: 1 },
      { key: 'char', count: 3 },
    ])
  })
})
