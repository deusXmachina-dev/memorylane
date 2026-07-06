interface TimeBounded {
  startTimestamp: number
  endTimestamp: number
}

// A gap longer than this between one activity ending and the next starting means
// the two belong to separate occurrences of a task, not one sitting. The miner
// may cite a recurring action's occurrences scattered across the day in a single
// candidate; splitting on this gap turns that into one sighting per occurrence.
export const EPISODE_GAP_MS = 15 * 60 * 1000

/**
 * Partition activities into occurrences ("episodes") on idle gaps. Activities are
 * sorted by start time; a new episode begins whenever the gap from the previous
 * activity's end to the next activity's start exceeds `gapMs`. Each returned group
 * is one contiguous sitting — the unit a single sighting should represent.
 */
export function splitIntoEpisodes<T extends TimeBounded>(
  activities: readonly T[],
  gapMs: number = EPISODE_GAP_MS,
): T[][] {
  if (activities.length === 0) return []
  const sorted = [...activities].sort((a, b) => a.startTimestamp - b.startTimestamp)
  const episodes: T[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd =
      episodes[episodes.length - 1][episodes[episodes.length - 1].length - 1].endTimestamp
    if (sorted[i].startTimestamp - prevEnd > gapMs) {
      episodes.push([sorted[i]])
    } else {
      episodes[episodes.length - 1].push(sorted[i])
    }
  }
  return episodes
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
