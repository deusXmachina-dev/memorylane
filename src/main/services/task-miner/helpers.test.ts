import { describe, it, expect } from 'vitest'
import { computeEpisodeWindow, tryExtractJsonArray } from './helpers'

describe('computeEpisodeWindow', () => {
  it('derives the window from min start / max end and sums active time', () => {
    // Two 2-min activities 6 min apart: span = 0..600000 (10 min), active 4 min.
    const activities = [
      { startTimestamp: 0, endTimestamp: 120_000 },
      { startTimestamp: 480_000, endTimestamp: 600_000 },
    ]
    const w = computeEpisodeWindow(activities)
    expect(w.startedAt).toBe(0)
    expect(w.endedAt).toBe(600_000)
    expect(w.interactionMin).toBe(4) // 2 + 2, NOT the 10-min wall-clock span
  })

  it('excludes a short gap — the user was in another app', () => {
    // 2-min activity, 2-min gap, 2-min activity. The presence heartbeat keeps a
    // window alive while the user is at the machine, so the gap is elsewhere.
    const w = computeEpisodeWindow([
      { startTimestamp: 0, endTimestamp: 120_000 },
      { startTimestamp: 240_000, endTimestamp: 360_000 },
    ])
    expect(w.interactionMin).toBe(4)
  })

  it('excludes a one-millisecond gap', () => {
    const w = computeEpisodeWindow([
      { startTimestamp: 0, endTimestamp: 120_000 },
      { startTimestamp: 120_001, endTimestamp: 240_001 },
    ])
    expect(w.interactionMin).toBe(4)
  })

  it('counts a long read whole across the chunks it is stored as', () => {
    // A 20-min read is cut into 5-min activities by MAX_ACTIVITY_DURATION_MS.
    // buildWindowChunks ends a chunk at start + max - 1 and starts the next at
    // end + 1, so the chunks sit 1ms apart, not flush: the union still counts
    // all 20 min.
    const activities = Array.from({ length: 4 }, (_, i) => ({
      startTimestamp: i * 300_000,
      endTimestamp: i * 300_000 + 299_999,
    }))
    expect(computeEpisodeWindow(activities).interactionMin).toBe(20)
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

  it('keeps active time within the wall-clock span', () => {
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
    expect(w.interactionMin).toBe(90) // 30 + 60 active, the 30-min break excluded
  })

  it('never exceeds the time the activities themselves cover', () => {
    // The guarantee the gap bridge broke: two tasks interleaved across the same
    // hour cannot together claim more than the hour actually captured.
    const taskA = [
      { startTimestamp: 0, endTimestamp: 60_000 },
      { startTimestamp: 180_000, endTimestamp: 240_000 },
    ]
    const taskB = [{ startTimestamp: 60_000, endTimestamp: 180_000 }]
    const total =
      computeEpisodeWindow(taskA).interactionMin + computeEpisodeWindow(taskB).interactionMin
    expect(total).toBe(4) // the whole 0–240000 window, counted once
  })
})

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
