import { describe, it, expect } from 'vitest'
import { matchGoldens, combineGoldenScore, DEFAULT_MIN_OVERLAP_RATIO } from './golden'
import type { GoldenEntry } from './types'

const T0 = 1_000_000

function golden(over: Partial<GoldenEntry> & { id: string }): GoldenEntry {
  return {
    appName: 'Code',
    startOffsetMs: 0,
    endOffsetMs: 10_000,
    summary: 'ideal',
    ...over,
  }
}

function activity(
  id: string,
  startOffsetMs: number,
  endOffsetMs: number,
  extra: Partial<{ windowTitle: string; tld: string }> = {},
) {
  return {
    activityId: id,
    startTimestamp: T0 + startOffsetMs,
    endTimestamp: T0 + endOffsetMs,
    ...extra,
  }
}

describe('matchGoldens', () => {
  it('matches a golden to the time-overlapping activity', () => {
    const report = matchGoldens({
      activities: [activity('a1', 0, 10_000)],
      goldens: [golden({ id: 'g1' })],
      sessionStartTimestamp: T0,
    })
    expect(report.matches).toHaveLength(1)
    expect(report.matches[0]).toMatchObject({ goldenId: 'g1', activityId: 'a1' })
    expect(report.matches[0].overlapRatio).toBe(1)
    expect(report.unmatchedGoldenIds).toEqual([])
    expect(report.unmatchedActivityIds).toEqual([])
  })

  it('rejects matches below the overlap threshold', () => {
    // golden 0-10s, activity 9-19s -> overlap 1s / min(10s,10s) = 0.1 < 0.3
    const report = matchGoldens({
      activities: [activity('a1', 9_000, 19_000)],
      goldens: [golden({ id: 'g1' })],
      sessionStartTimestamp: T0,
    })
    expect(report.matches).toHaveLength(0)
    expect(report.unmatchedGoldenIds).toEqual(['g1'])
    expect(report.unmatchedActivityIds).toEqual(['a1'])
  })

  it('greedily assigns the best overlap and reports the rest unmatched', () => {
    // Two activities overlap g1; the one with full overlap wins.
    const report = matchGoldens({
      activities: [activity('partial', 5_000, 15_000), activity('full', 0, 10_000)],
      goldens: [golden({ id: 'g1' })],
      sessionStartTimestamp: T0,
    })
    expect(report.matches).toHaveLength(1)
    expect(report.matches[0].activityId).toBe('full')
    expect(report.unmatchedActivityIds).toContain('partial')
  })

  it('breaks ties by window/tld equality', () => {
    const report = matchGoldens({
      activities: [
        activity('nomatch', 0, 10_000),
        activity('match', 0, 10_000, { tld: 'github.com' }),
      ],
      goldens: [golden({ id: 'g1', tld: 'github.com' })],
      sessionStartTimestamp: T0,
    })
    expect(report.matches[0].activityId).toBe('match')
  })

  it('uses the configured minimum overlap ratio', () => {
    const report = matchGoldens({
      activities: [activity('a1', 9_000, 19_000)],
      goldens: [golden({ id: 'g1' })],
      sessionStartTimestamp: T0,
      minOverlapRatio: 0.05,
    })
    expect(report.matches).toHaveLength(1)
  })

  it('exposes a sensible default threshold', () => {
    expect(DEFAULT_MIN_OVERLAP_RATIO).toBe(0.3)
  })
})

describe('combineGoldenScore', () => {
  it('weights embedSim 0.4 and judge 0.6', () => {
    expect(combineGoldenScore(1, 0)).toBeCloseTo(0.4, 5)
    expect(combineGoldenScore(0, 1)).toBeCloseTo(0.6, 5)
  })
  it('falls back to whichever signal is present', () => {
    expect(combineGoldenScore(null, 0.8)).toBe(0.8)
    expect(combineGoldenScore(0.5, null)).toBe(0.5)
    expect(combineGoldenScore(null, null)).toBeNull()
  })
})
