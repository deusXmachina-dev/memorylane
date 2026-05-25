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
  // activities arrive newest-first; group into days (keeping newest-first), then
  // within each day group consecutive same-app/same-window into runs.
  const days = new Map<number, ActivityDetail[]>()
  for (const a of items) {
    const day = startOfLocalDay(a.startTimestamp)
    const arr = days.get(day) ?? []
    arr.push(a)
    days.set(day, arr)
  }

  const result: DayGroup[] = []
  for (const [dayStart, dayActs] of days) {
    // dayActs is newest-first; sort ascending so roll-up reads chronologically.
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
    // Show newest run first within the day.
    runs.reverse()
    result.push({ dayStart, runs })
  }
  // Days newest first.
  result.sort((a, b) => b.dayStart - a.dayStart)
  return result
}
