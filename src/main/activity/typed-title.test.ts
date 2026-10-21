import { describe, expect, it } from 'vitest'
import { isTypedTitleEdit } from './typed-title'

const notepad = (title: string, windowId = '0x1') => ({
  processName: 'Notepad',
  windowId,
  title,
})

describe('isTypedTitleEdit', () => {
  it.each([
    ['append at end', 'I - Notepad', 'I n - Notepad'],
    ['insert in middle', 'Hllo - Notepad', 'Hello - Notepad'],
    ['insert at start', 'ello - Notepad', 'Hello - Notepad'],
    ['multi-char paste', 'Hi - Notepad', 'Hi there - Notepad'],
    ['delete one char', 'Hello - Notepad', 'Hell - Notepad'],
    ['delete a run', 'Hello world - Notepad', 'Hello - Notepad'],
    ['repeated chars', 'aa - Notepad', 'aaa - Notepad'],
    ['dirty marker', 'I ne - Notepad', '*I ne - Notepad'],
  ])('accepts %s', (_, prev, next) => {
    expect(isTypedTitleEdit(notepad(prev), notepad(next))).toBe(true)
  })

  it.each([
    ['substitution', 'Hello - Notepad', 'Hallo - Notepad'],
    ['edits at two spots', 'ab - Notepad', 'xaby - Notepad'],
    ['unrelated title', 'notes - Notepad', 'other.txt - Notepad'],
    ['unchanged title', 'Hello - Notepad', 'Hello - Notepad'],
    ['empty previous title', '', 'H - Notepad'],
    ['empty next title', 'H - Notepad', ''],
  ])('rejects %s', (_, prev, next) => {
    expect(isTypedTitleEdit(notepad(prev), notepad(next))).toBe(false)
  })

  it('matches the process name case-insensitively', () => {
    const prev = { ...notepad('I - Notepad'), processName: 'NOTEPAD' }
    const next = { ...notepad('I n - Notepad'), processName: 'NOTEPAD' }
    expect(isTypedTitleEdit(prev, next)).toBe(true)
  })

  it('rejects other apps', () => {
    const slack = (title: string) => ({ processName: 'Slack', windowId: '0x1', title })
    expect(isTypedTitleEdit(slack('Slack'), slack('(3) Slack'))).toBe(false)
  })

  it('rejects a change of process', () => {
    const prev = { ...notepad('I - Notepad'), processName: 'Code' }
    expect(isTypedTitleEdit(prev, notepad('I n - Notepad'))).toBe(false)
  })

  it('rejects a different window', () => {
    expect(isTypedTitleEdit(notepad('I - Notepad', '0x1'), notepad('I n - Notepad', '0x2'))).toBe(
      false,
    )
  })

  it('rejects windows without an id', () => {
    const prev = { processName: 'Notepad', title: 'I - Notepad' }
    const next = { processName: 'Notepad', title: 'I n - Notepad' }
    expect(isTypedTitleEdit(prev, next)).toBe(false)
  })
})
