import { describe, it, expect } from 'vitest'
import { computeRecurrence, isBelowNoiseFloor, mean, resolveTitle } from './cluster-view'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 6, 6, 12, 0, 0) // 2026-07-06, mid-day UTC

describe('computeRecurrence', () => {
  it('returns empty for no sightings', () => {
    expect(computeRecurrence([], NOW)).toEqual({ unit: 'day', buckets: [] })
  })

  it('uses day buckets for a short span', () => {
    const r = computeRecurrence([NOW], NOW)
    expect(r.unit).toBe('day')
    expect(r.buckets).toEqual([{ start: Date.UTC(2026, 6, 6), count: 1 }])
  })

  it('zero-fills day gaps', () => {
    const r = computeRecurrence([NOW - 3 * DAY_MS, NOW], NOW)
    expect(r.unit).toBe('day')
    expect(r.buckets.map((b) => b.count)).toEqual([1, 0, 0, 1])
  })

  it('counts multiple sightings in the same day', () => {
    const r = computeRecurrence([NOW, NOW - 1000, NOW - 2000], NOW)
    expect(r.buckets.map((b) => b.count)).toEqual([3])
  })

  it('switches to week buckets once the span exceeds the bucket budget', () => {
    const r = computeRecurrence([NOW - 60 * DAY_MS, NOW], NOW)
    expect(r.unit).toBe('week')
    expect(r.buckets.reduce((s, b) => s + b.count, 0)).toBe(2)
    expect(r.buckets[r.buckets.length - 1].count).toBe(1)
  })

  it('caps to the most recent maxBuckets', () => {
    const r = computeRecurrence([NOW - 100 * DAY_MS, NOW], NOW, 4)
    expect(r.unit).toBe('week')
    expect(r.buckets).toHaveLength(4)
    expect(r.buckets[0].count).toBe(0) // old sighting beyond the cap
    expect(r.buckets[3].count).toBe(1) // current bucket
  })
})

describe('resolveTitle', () => {
  it('uses the label when present', () => {
    expect(resolveTitle('Reconcile invoices', ['a', 'b'])).toBe('Reconcile invoices')
  })

  it('trims the label', () => {
    expect(resolveTitle('  Move funds  ', [])).toBe('Move funds')
  })

  it('falls back to the most common member title', () => {
    expect(resolveTitle('', ['Pay bills', 'Pay bills', 'Other'])).toBe('Pay bills')
  })

  it('breaks ties by earliest occurrence', () => {
    expect(resolveTitle('', ['First', 'Second'])).toBe('First')
  })

  it('returns a fallback when nothing is available', () => {
    expect(resolveTitle('', [])).toBe('Untitled task')
    expect(resolveTitle('   ', ['  '])).toBe('Untitled task')
  })
})

describe('mean', () => {
  it('returns 0 for an empty list', () => {
    expect(mean([])).toBe(0)
  })

  it('averages values', () => {
    expect(mean([4, 8])).toBe(6)
  })
})

describe('isBelowNoiseFloor', () => {
  it('hides a singleton with little total time', () => {
    expect(isBelowNoiseFloor(1, 5)).toBe(true)
  })

  it('keeps a singleton once its total time clears the floor', () => {
    expect(isBelowNoiseFloor(1, 20)).toBe(false)
  })

  it('keeps anything seen twice, however small', () => {
    expect(isBelowNoiseFloor(2, 0)).toBe(false)
  })
})
