import { describe, it, expect } from 'vitest'
import { tryExtractJsonArray, extractJsonArray } from './helpers'

describe('tryExtractJsonArray', () => {
  it('parses a fenced JSON array', () => {
    expect(tryExtractJsonArray('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }])
  })

  it('parses a bare JSON array', () => {
    expect(tryExtractJsonArray('[1, 2]')).toEqual([1, 2])
  })

  it('parses an array embedded in prose', () => {
    expect(tryExtractJsonArray('Here you go: [1] done')).toEqual([1])
  })

  it('returns an empty array for a parsed [] (a real answer, not a failure)', () => {
    expect(tryExtractJsonArray('[]')).toEqual([])
    expect(tryExtractJsonArray('```json\n[]\n```')).toEqual([])
  })

  it('returns null when no JSON array can be parsed', () => {
    expect(tryExtractJsonArray('')).toBeNull()
    expect(tryExtractJsonArray('sorry, I cannot help with that')).toBeNull()
    expect(tryExtractJsonArray('{"not": "an array"}')).toBeNull()
    expect(tryExtractJsonArray('[{"truncated": ')).toBeNull()
  })
})

describe('extractJsonArray', () => {
  it('maps parse failure to an empty array', () => {
    expect(extractJsonArray('no json here')).toEqual([])
    expect(extractJsonArray('[1]')).toEqual([1])
  })
})
