interface TimeBounded {
  startTimestamp: number
  endTimestamp: number
}

/**
 * Compute a sighting's time window and on-task interaction time directly from
 * its constituent activities — never from an LLM estimate.
 *
 * - `startedAt` / `endedAt`: min start / max end across the activities.
 * - `interactionMin`: Σ of each activity's own duration (actual interaction
 *   time, excludes idle gaps between activities). Wall-clock span is just
 *   `endedAt - startedAt` and is derived on read, not stored.
 */
export function computeEpisodeWindow(activities: TimeBounded[]): {
  startedAt: number
  endedAt: number
  interactionMin: number
} {
  if (activities.length === 0) {
    return { startedAt: 0, endedAt: 0, interactionMin: 0 }
  }
  let startedAt = Infinity
  let endedAt = -Infinity
  let interactionMs = 0
  for (const a of activities) {
    if (a.startTimestamp < startedAt) startedAt = a.startTimestamp
    if (a.endTimestamp > endedAt) endedAt = a.endTimestamp
    interactionMs += Math.max(0, a.endTimestamp - a.startTimestamp)
  }
  return {
    startedAt,
    endedAt,
    interactionMin: Math.round((interactionMs / 60000) * 10) / 10,
  }
}
