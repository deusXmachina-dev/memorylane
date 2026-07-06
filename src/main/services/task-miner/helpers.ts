interface TimeBounded {
  startTimestamp: number
  endTimestamp: number
}

// The scan prompt requires every finding description to end with exactly one
// "Replace with: <mechanism>." sentence. Tolerant of case and trailing period.
export const MECHANISM_RE = /replace with:\s*(.+?)\.?\s*$/i

/** The mechanism sentence's payload from a sighting description, or null. */
export function parseReplaceWith(description: string): string | null {
  const match = MECHANISM_RE.exec(description.trim())
  const mechanism = match?.[1]?.trim().replace(/[.\s]+$/, '')
  return mechanism ? mechanism : null
}

/**
 * Compute a sighting's time window and on-task interaction time directly from
 * its constituent activities — never from an LLM estimate.
 *
 * - `startedAt` / `endedAt`: min start / max end across the activities.
 * - `interactionMin`: union of the activities' [start, end] intervals (actual
 *   interaction time, excludes idle gaps between activities). Overlapping or
 *   nested activities are not double-counted, so active time never exceeds the
 *   wall-clock span. Span is just `endedAt - startedAt`, derived on read.
 */
export function computeEpisodeWindow(activities: TimeBounded[]): {
  startedAt: number
  endedAt: number
  interactionMin: number
} {
  if (activities.length === 0) {
    return { startedAt: 0, endedAt: 0, interactionMin: 0 }
  }
  const intervals = activities
    .map((a) => ({ start: a.startTimestamp, end: Math.max(a.startTimestamp, a.endTimestamp) }))
    .sort((a, b) => a.start - b.start)
  const startedAt = intervals[0].start
  let endedAt = intervals[0].end
  let unionMs = 0
  let curEnd = intervals[0].end
  let curStart = intervals[0].start
  for (let i = 1; i < intervals.length; i++) {
    const { start, end } = intervals[i]
    if (start <= curEnd) {
      curEnd = Math.max(curEnd, end)
    } else {
      unionMs += curEnd - curStart
      curStart = start
      curEnd = end
    }
    if (end > endedAt) endedAt = end
  }
  unionMs += curEnd - curStart
  return {
    startedAt,
    endedAt,
    interactionMin: Math.round((unionMs / 60000) * 10) / 10,
  }
}
