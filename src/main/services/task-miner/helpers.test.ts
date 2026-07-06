import { describe, it, expect } from 'vitest'
import { computeEpisodeWindow, splitIntoEpisodes, EPISODE_GAP_MS } from './helpers'

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

describe('splitIntoEpisodes', () => {
  const MIN = 60_000
  const act = (startMin: number, durMin = 1) => ({
    id: `${startMin}`,
    startTimestamp: startMin * MIN,
    endTimestamp: (startMin + durMin) * MIN,
  })

  it('keeps a contiguous run as a single episode', () => {
    const eps = splitIntoEpisodes([act(0), act(1), act(2)])
    expect(eps).toHaveLength(1)
    expect(eps[0].map((a) => a.id)).toEqual(['0', '1', '2'])
  })

  it('splits scattered occurrences on the idle gap — one episode each', () => {
    // Same action at 0, then ~3h later, then ~2h after that.
    const eps = splitIntoEpisodes([act(0), act(180), act(300)])
    expect(eps).toHaveLength(3)
    expect(eps.map((e) => e.length)).toEqual([1, 1, 1])
  })

  it('groups within-sitting activities but breaks across the gap threshold', () => {
    const eps = splitIntoEpisodes([act(0), act(2), act(60), act(61)])
    expect(eps.map((e) => e.map((a) => a.id))).toEqual([
      ['0', '2'],
      ['60', '61'],
    ])
  })

  it('sorts before splitting so id order in the candidate does not matter', () => {
    const eps = splitIntoEpisodes([act(300), act(1), act(0), act(180)])
    expect(eps.map((e) => e[0].id)).toEqual(['0', '180', '300'])
    expect(eps[0].map((a) => a.id)).toEqual(['0', '1'])
  })

  it('does not split when the gap is exactly at the threshold', () => {
    const eps = splitIntoEpisodes([
      { id: 'a', startTimestamp: 0, endTimestamp: 0 },
      { id: 'b', startTimestamp: EPISODE_GAP_MS, endTimestamp: EPISODE_GAP_MS },
    ])
    expect(eps).toHaveLength(1)
  })

  it('returns no episodes for no activities', () => {
    expect(splitIntoEpisodes([])).toEqual([])
  })
})
