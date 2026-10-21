import { describe, it, expect } from 'vitest'
import { isIncrementalTitleEdit, normalizeTitle } from './window-title'

describe('normalizeTitle', () => {
  it('drops symbol glyphs and collapses whitespace', () => {
    expect(normalizeTitle('⠋  Broken   link ')).toBe('Broken link')
  })
})

describe('isIncrementalTitleEdit', () => {
  it('accepts a single insertion or deletion', () => {
    expect(isIncrementalTitleEdit('I - Notepad', 'I n - Notepad')).toBe(true)
    expect(isIncrementalTitleEdit('I ne - Notepad', '*I ne - Notepad')).toBe(true)
    expect(isIncrementalTitleEdit('I ne - Notepad', 'I n - Notepad')).toBe(true)
  })

  it('rejects replacements', () => {
    expect(isIncrementalTitleEdit('a.ts - Code', 'b.ts - Code')).toBe(false)
    expect(isIncrementalTitleEdit('(3) Slack', '(4) Slack')).toBe(false)
  })

  it('rejects empty and unchanged titles', () => {
    expect(isIncrementalTitleEdit('', 'Notepad')).toBe(false)
    expect(isIncrementalTitleEdit('Notepad', 'Notepad')).toBe(false)
  })
})
