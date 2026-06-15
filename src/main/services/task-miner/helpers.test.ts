import { describe, it, expect } from 'vitest'
import { computeEpisodeWindow } from './helpers'

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
})
