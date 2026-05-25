import { describe, expect, it } from 'vitest'
import type { ActivityDetail } from '@types'
import { groupIntoRunsByDay, ROLLUP_GAP_MS } from './audit-log-grouping'

function makeActivity(overrides: Partial<ActivityDetail> & { id: string }): ActivityDetail {
  return {
    id: overrides.id,
    startTimestamp: overrides.startTimestamp ?? 0,
    endTimestamp: overrides.endTimestamp ?? (overrides.startTimestamp ?? 0) + 1_000,
    appName: overrides.appName ?? 'Chrome',
    windowTitle: overrides.windowTitle ?? '',
    tld: overrides.tld ?? null,
    summary: overrides.summary ?? '',
  }
}

// Local-day boundary at the test machine's offset. Picking noon avoids DST edges.
const DAY_1_NOON = new Date(2025, 0, 10, 12, 0, 0, 0).getTime()
const DAY_0_NOON = DAY_1_NOON - 24 * 60 * 60 * 1000

describe('groupIntoRunsByDay', () => {
  it('returns an empty array for no items', () => {
    expect(groupIntoRunsByDay([])).toEqual([])
  })

  it('buckets items into days with the newest day first', () => {
    const today = makeActivity({ id: 'today', startTimestamp: DAY_1_NOON })
    const yesterday = makeActivity({ id: 'yesterday', startTimestamp: DAY_0_NOON })
    // input is newest-first
    const result = groupIntoRunsByDay([today, yesterday])
    expect(result).toHaveLength(2)
    expect(result[0].runs[0][0].id).toBe('today')
    expect(result[1].runs[0][0].id).toBe('yesterday')
    expect(result[0].dayStart).toBeGreaterThan(result[1].dayStart)
  })

  it('collapses consecutive same-app/same-window captures within the rollup gap into one run', () => {
    const a = makeActivity({
      id: 'a',
      appName: 'Chrome',
      windowTitle: 'Inbox',
      startTimestamp: DAY_1_NOON,
      endTimestamp: DAY_1_NOON + 30_000,
    })
    const b = makeActivity({
      id: 'b',
      appName: 'Chrome',
      windowTitle: 'Inbox',
      // 60s gap, under the 90s threshold
      startTimestamp: DAY_1_NOON + 90_000,
      endTimestamp: DAY_1_NOON + 120_000,
    })
    const c = makeActivity({
      id: 'c',
      appName: 'Chrome',
      windowTitle: 'Inbox',
      startTimestamp: DAY_1_NOON + 180_000,
      endTimestamp: DAY_1_NOON + 210_000,
    })
    // newest-first order at the input
    const result = groupIntoRunsByDay([c, b, a])
    expect(result).toHaveLength(1)
    expect(result[0].runs).toHaveLength(1)
    // Run is chronological (ascending) within itself
    expect(result[0].runs[0].map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('starts a new run when the gap exceeds ROLLUP_GAP_MS', () => {
    const a = makeActivity({
      id: 'a',
      appName: 'Chrome',
      windowTitle: 'Inbox',
      startTimestamp: DAY_1_NOON,
      endTimestamp: DAY_1_NOON + 1_000,
    })
    const b = makeActivity({
      id: 'b',
      appName: 'Chrome',
      windowTitle: 'Inbox',
      // gap of ROLLUP_GAP_MS + 1ms from a's end
      startTimestamp: DAY_1_NOON + 1_000 + ROLLUP_GAP_MS + 1,
      endTimestamp: DAY_1_NOON + 1_000 + ROLLUP_GAP_MS + 2_000,
    })
    const result = groupIntoRunsByDay([b, a])
    expect(result).toHaveLength(1)
    expect(result[0].runs).toHaveLength(2)
    // Newest run first within day
    expect(result[0].runs[0][0].id).toBe('b')
    expect(result[0].runs[1][0].id).toBe('a')
  })

  it('starts a new run when app or window title changes', () => {
    const a = makeActivity({
      id: 'a',
      appName: 'Chrome',
      windowTitle: 'Inbox',
      startTimestamp: DAY_1_NOON,
      endTimestamp: DAY_1_NOON + 1_000,
    })
    const b = makeActivity({
      id: 'b',
      appName: 'Chrome',
      windowTitle: 'Calendar',
      startTimestamp: DAY_1_NOON + 2_000,
      endTimestamp: DAY_1_NOON + 3_000,
    })
    const c = makeActivity({
      id: 'c',
      appName: 'Slack',
      windowTitle: 'Calendar',
      startTimestamp: DAY_1_NOON + 4_000,
      endTimestamp: DAY_1_NOON + 5_000,
    })
    const result = groupIntoRunsByDay([c, b, a])
    expect(result).toHaveLength(1)
    expect(result[0].runs).toHaveLength(3)
    // Newest first
    expect(result[0].runs.map((r) => r[0].id)).toEqual(['c', 'b', 'a'])
  })

  it('keeps runs scoped to their day even when same app/window crosses midnight', () => {
    const yesterdayLate = makeActivity({
      id: 'y',
      appName: 'Chrome',
      windowTitle: 'Inbox',
      startTimestamp: DAY_0_NOON,
      endTimestamp: DAY_0_NOON + 1_000,
    })
    const todayEarly = makeActivity({
      id: 't',
      appName: 'Chrome',
      windowTitle: 'Inbox',
      startTimestamp: DAY_1_NOON,
      endTimestamp: DAY_1_NOON + 1_000,
    })
    const result = groupIntoRunsByDay([todayEarly, yesterdayLate])
    expect(result).toHaveLength(2)
    expect(result[0].runs).toHaveLength(1)
    expect(result[1].runs).toHaveLength(1)
  })
})
