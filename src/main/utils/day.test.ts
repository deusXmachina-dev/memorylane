import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getDayBoundaries } from './day'

describe('getDayBoundaries', () => {
  const originalTZ = process.env.TZ

  beforeEach(() => {
    vi.useFakeTimers()
    process.env.TZ = 'America/New_York'
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalTZ === undefined) delete process.env.TZ
    else process.env.TZ = originalTZ
  })

  it('spans 24 hours on a regular day', () => {
    vi.setSystemTime(new Date(2026, 6, 15, 12, 0, 0))
    const { start, end, label } = getDayBoundaries(1)
    expect(label).toBe('2026-07-14')
    expect(end - start + 1).toBe(24 * 3_600_000)
  })

  it('spans 23 hours on the spring-forward day', () => {
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
    const { start, end, label } = getDayBoundaries(2)
    expect(label).toBe('2026-03-08')
    expect(end - start + 1).toBe(23 * 3_600_000)
  })

  it('spans 25 hours on the fall-back day', () => {
    vi.setSystemTime(new Date(2026, 10, 3, 12, 0, 0))
    const { start, end, label } = getDayBoundaries(2)
    expect(label).toBe('2026-11-01')
    expect(end - start + 1).toBe(25 * 3_600_000)
  })

  it('adjacent day windows abut exactly across a DST transition', () => {
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
    expect(getDayBoundaries(2).end + 1).toBe(getDayBoundaries(1).start)
  })
})
