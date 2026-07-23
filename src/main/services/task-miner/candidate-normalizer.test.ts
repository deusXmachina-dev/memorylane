import { describe, it, expect } from 'vitest'
import { normalizeScanCandidates, normalizeSteps } from './candidate-normalizer'

describe('normalizeSteps', () => {
  it('keeps trimmed non-empty strings in order', () => {
    expect(normalizeSteps(['  TestApp: open the export ', 'notion.so: paste the rows'])).toEqual([
      'TestApp: open the export',
      'notion.so: paste the rows',
    ])
  })

  it('drops non-strings and blank entries', () => {
    expect(normalizeSteps(['ok', 42, '', null, '   ', {}])).toEqual(['ok'])
  })

  it('returns [] for non-array input', () => {
    expect(normalizeSteps(undefined)).toEqual([])
    expect(normalizeSteps('TestApp: not a list')).toEqual([])
  })

  it('caps entry length and step count', () => {
    const long = 'x'.repeat(500)
    expect(normalizeSteps([long])[0]).toHaveLength(200)
    expect(normalizeSteps(Array.from({ length: 30 }, (_, i) => `step ${i}`))).toHaveLength(15)
  })
})

describe('normalizeScanCandidates steps handling', () => {
  const base = { title: 't', description: 'd', activity_ids: ['a1'] }

  it('defaults steps to [] without counting the candidate malformed', () => {
    const { candidates, malformedCount } = normalizeScanCandidates([base])
    expect(candidates[0].steps).toEqual([])
    expect(malformedCount).toBe(0)
  })

  it('normalizes malformed steps instead of dropping the candidate', () => {
    const { candidates, malformedCount } = normalizeScanCandidates([
      { ...base, steps: 'not an array' },
      { ...base, steps: ['TestApp: fine', 7] },
    ])
    expect(candidates.map((c) => c.steps)).toEqual([[], ['TestApp: fine']])
    expect(malformedCount).toBe(0)
  })
})
