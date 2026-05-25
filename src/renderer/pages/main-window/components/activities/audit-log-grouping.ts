import type { ActivityDetail } from '@types'
import { startOfLocalDay } from './format'

export const ROLLUP_GAP_MS = 90 * 1000

function sameRollupKey(a: ActivityDetail, b: ActivityDetail): boolean {
  return a.appName === b.appName && (a.windowTitle ?? '') === (b.windowTitle ?? '')
}

export interface DayGroup {
  dayStart: number
  runs: ActivityDetail[][]
}

export function groupIntoRunsByDay(items: ActivityDetail[]): DayGroup[] {
  const days = new Map<number, ActivityDetail[]>()
  for (const a of items) {
    const day = startOfLocalDay(a.startTimestamp)
    const arr = days.get(day) ?? []
    arr.push(a)
    days.set(day, arr)
  }

  const result: DayGroup[] = []
  for (const [dayStart, dayActs] of days) {
    // Sort ascending so adjacency-based roll-up reads chronologically.
    const ascending = [...dayActs].sort((a, b) => a.startTimestamp - b.startTimestamp)
    const runs: ActivityDetail[][] = []
    for (const a of ascending) {
      const last = runs[runs.length - 1]
      const prev = last?.[last.length - 1]
      if (
        last &&
        prev &&
        sameRollupKey(prev, a) &&
        a.startTimestamp - prev.endTimestamp <= ROLLUP_GAP_MS
      ) {
        last.push(a)
      } else {
        runs.push([a])
      }
    }
    runs.reverse()
    result.push({ dayStart, runs })
  }
  result.sort((a, b) => b.dayStart - a.dayStart)
  return result
}
