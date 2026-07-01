import { describe, it, expect } from 'vitest'
import { servedActivityId } from './task-replay'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The miner's scan prompt serializes each activity's id verbatim, so the id a
 * fixture activity is *served* under must leak nothing about whether it's the
 * planted task, its step order, or its recurrence. These lock that guarantee.
 */
describe('servedActivityId', () => {
  it('is deterministic (same fixture id → same served id)', () => {
    expect(servedActivityId('jaro-2026-06-19-02')).toBe(servedActivityId('jaro-2026-06-19-02'))
  })

  it('is an opaque uuid, not the readable fixture id', () => {
    const served = servedActivityId('jaro-2026-06-19-02')
    expect(served).toMatch(UUID_RE)
    expect(served).not.toBe('jaro-2026-06-19-02')
    expect(served).not.toContain('jaro')
  })

  it('hides the planted-vs-noise, order, and occurrence signal', () => {
    const planted = servedActivityId('jaro-2026-06-19-03-o2')
    // no leftover prefix / ordinal / occurrence tag
    expect(planted).not.toMatch(/jaro|-o\d|19-0\d/)
    // a noise-style uuid input maps to the same shape — indistinguishable by id
    expect(servedActivityId('63c078a9-007d-504c-977b-e3fbf9b8ecdc')).toMatch(UUID_RE)
  })

  it('maps distinct fixture ids to distinct served ids (incl. adjacent steps)', () => {
    const ids = [
      'jaro-2026-06-19-02',
      'jaro-2026-06-19-03',
      'jaro-2026-06-19-03-o1',
      'jaro-2026-06-19-03-o2',
    ].map(servedActivityId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
