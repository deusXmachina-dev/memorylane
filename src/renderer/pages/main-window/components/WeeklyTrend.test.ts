import { describe, expect, it } from 'vitest'
import { weeklyCounts } from './WeeklyTrend'

// Wednesday, July 15 2026 (local). This week's Monday is July 13.
const NOW = new Date(2026, 6, 15, 12).getTime()

describe('weeklyCounts', () => {
  it('returns four zero buckets for no timestamps', () => {
    expect(weeklyCounts([], NOW)).toEqual([0, 0, 0, 0])
  })

  it('buckets into Monday-anchored weeks, current partial week last', () => {
    const monday = new Date(2026, 6, 13).getTime()
    const counts = weeklyCounts(
      [
        NOW, // this week
        monday, // Monday 00:00 belongs to this week
        monday - 1, // Sunday 23:59:59.999 → last week
        new Date(2026, 6, 1).getTime(), // 2 weeks ago
        new Date(2026, 5, 22).getTime(), // 3 weeks ago (oldest included Monday)
      ],
      NOW,
    )
    expect(counts).toEqual([1, 1, 1, 2])
  })

  it('ignores timestamps older than 4 weeks', () => {
    expect(weeklyCounts([new Date(2026, 5, 21, 23).getTime()], NOW)).toEqual([0, 0, 0, 0])
  })
})
