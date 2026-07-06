import { describe, it, expect } from 'vitest'
import { computeEpisodeWindow, parseReplaceWith } from './helpers'

describe('parseReplaceWith', () => {
  it('extracts the mechanism tail', () => {
    expect(parseReplaceWith('Filed the report. Replace with: a scheduled export.')).toBe(
      'a scheduled export',
    )
  })

  it('tolerates case and a missing trailing period', () => {
    expect(parseReplaceWith('Did it. replace with: a webhook')).toBe('a webhook')
  })

  it('returns null when the sentence is absent or empty', () => {
    expect(parseReplaceWith('Just did the thing.')).toBeNull()
    expect(parseReplaceWith('Replace with: .')).toBeNull()
  })
})

describe('computeEpisodeWindow', () => {
  it('derives the window from min start / max end and sums interaction time', () => {
    // Two 2-min activities with a 6-min idle gap between them:
    // span = 0..600000 (10 min), interaction = 4 min.
    const activities = [
      { startTimestamp: 0, endTimestamp: 120_000 },
      { startTimestamp: 480_000, endTimestamp: 600_000 },
    ]
    const w = computeEpisodeWindow(activities)
    expect(w.startedAt).toBe(0)
    expect(w.endedAt).toBe(600_000)
    expect(w.interactionMin).toBe(4) // 2 + 2, NOT the 10-min wall-clock span
  })

  it('is order-independent', () => {
    const a = [
      { startTimestamp: 1000, endTimestamp: 2000 },
      { startTimestamp: 5000, endTimestamp: 9000 },
    ]
    const forward = computeEpisodeWindow(a)
    const reversed = computeEpisodeWindow([...a].reverse())
    expect(forward).toEqual(reversed)
  })

  it('returns zeros for no activities', () => {
    expect(computeEpisodeWindow([])).toEqual({ startedAt: 0, endedAt: 0, interactionMin: 0 })
  })

  it('does not double-count overlapping activities', () => {
    // A 0–10 min, B 5–15 min: union is 15 min, not 20.
    const w = computeEpisodeWindow([
      { startTimestamp: 0, endTimestamp: 600_000 },
      { startTimestamp: 300_000, endTimestamp: 900_000 },
    ])
    expect(w.interactionMin).toBe(15)
    expect(w.endedAt).toBe(900_000)
  })

  it('does not double-count a nested activity', () => {
    // A 0–30 min contains B 5–6 min: union is 30 min.
    const w = computeEpisodeWindow([
      { startTimestamp: 0, endTimestamp: 1_800_000 },
      { startTimestamp: 300_000, endTimestamp: 360_000 },
    ])
    expect(w.interactionMin).toBe(30)
    expect(w.endedAt).toBe(1_800_000)
  })

  it('keeps interaction time within the wall-clock span', () => {
    const fixtures = [
      [
        { startTimestamp: 0, endTimestamp: 600_000 },
        { startTimestamp: 100_000, endTimestamp: 500_000 },
        { startTimestamp: 550_000, endTimestamp: 700_000 },
      ],
      [
        { startTimestamp: 0, endTimestamp: 60_000 },
        { startTimestamp: 30_000, endTimestamp: 90_000 },
        { startTimestamp: 200_000, endTimestamp: 260_000 },
      ],
    ]
    for (const activities of fixtures) {
      const w = computeEpisodeWindow(activities)
      const spanMin = (w.endedAt - w.startedAt) / 60_000
      expect(w.interactionMin).toBeLessThanOrEqual(spanMin + 0.05)
    }
  })

  it('keeps a long continuous run whole — span spans the whole run', () => {
    // A 2-hour run with an internal break stays one window (no time-based split).
    const w = computeEpisodeWindow([
      { startTimestamp: 0, endTimestamp: 1_800_000 }, // 0–30 min
      { startTimestamp: 3_600_000, endTimestamp: 7_200_000 }, // 60–120 min
    ])
    expect(w.startedAt).toBe(0)
    expect(w.endedAt).toBe(7_200_000)
    expect(w.interactionMin).toBe(90) // 30 + 60 active, idle gap excluded
  })
})
