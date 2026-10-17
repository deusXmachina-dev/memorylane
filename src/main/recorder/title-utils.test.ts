import { describe, it, expect } from 'vitest'
import { titlesShareWords } from './title-utils'

describe('titlesShareWords', () => {
  it('treats spinner glyph variants as the same title', () => {
    expect(titlesShareWords('◐ Broken link', '✳ Broken link')).toBe(true)
  })

  it('detects titles with no words in common', () => {
    expect(titlesShareWords('✳ script-first-eval-recording', '✳ Linear workspace cleanup')).toBe(
      false,
    )
  })

  it('keeps titles sharing a project suffix together', () => {
    expect(titlesShareWords('.env — memorylane', 'index.ts — memorylane')).toBe(true)
  })

  it('ignores number-only differences', () => {
    expect(titlesShareWords('PR #261', 'PR #262')).toBe(true)
    expect(titlesShareWords('#261', '#262')).toBe(true)
  })

  it('never splits on a missing or blank title', () => {
    expect(titlesShareWords(undefined, 'Anything')).toBe(true)
    expect(titlesShareWords('Anything', '')).toBe(true)
    expect(titlesShareWords('✳', 'Anything')).toBe(true)
  })
})
