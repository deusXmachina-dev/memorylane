import * as fs from 'fs'
import type { ActivityFrame } from '@main/activity/activity-types'
import { dHashDifferencePercent, loadImageDHash } from './visual-diff'

export async function selectSnapshotFrames(params: {
  frames: ActivityFrame[]
  maxSnapshots: number
  interactionAnchorTimestamps?: number[]
  startAnchorTimestamp?: number
  endAnchorTimestamp?: number
  visualThresholdPercent?: number
}): Promise<ActivityFrame[]> {
  const {
    frames,
    maxSnapshots,
    interactionAnchorTimestamps = [],
    startAnchorTimestamp,
    endAnchorTimestamp,
    visualThresholdPercent,
  } = params

  const available = frames
    .filter((frame) => fs.existsSync(frame.frame.filepath))
    .sort((left, right) => {
      if (left.frame.timestamp !== right.frame.timestamp) {
        return left.frame.timestamp - right.frame.timestamp
      }
      return left.frame.sequenceNumber - right.frame.sequenceNumber
    })

  if (available.length === 0) {
    return []
  }

  const normalizedMaxSnapshots =
    Number.isInteger(maxSnapshots) && maxSnapshots > 0 ? maxSnapshots : 1
  if (available.length === 1 || normalizedMaxSnapshots === 1) {
    return [available[0]]
  }

  const anchors = uniqueSortedTimestamps(interactionAnchorTimestamps)
  const selectedByKey = new Map<string, ActivityFrame>()

  if (startAnchorTimestamp !== undefined) {
    const firstAtOrAfter = findFirstFrameAtOrAfter(available, startAnchorTimestamp)
    if (firstAtOrAfter) {
      selectedByKey.set(frameKey(firstAtOrAfter), firstAtOrAfter)
    }
  }

  if (endAnchorTimestamp !== undefined) {
    const lastAtOrBefore = findLastFrameAtOrBefore(available, endAnchorTimestamp)
    if (lastAtOrBefore) {
      selectedByKey.set(frameKey(lastAtOrBefore), lastAtOrBefore)
    }
  }

  for (const anchor of anchors) {
    const nearest = findNearestFrame(available, anchor)
    if (!nearest) continue
    selectedByKey.set(frameKey(nearest), nearest)
  }

  // Keep timeline boundaries stable regardless of interaction density.
  // When explicit start/end anchors are provided, preserve their directionality
  // semantics instead of force-including potentially stale boundary frames.
  if (startAnchorTimestamp === undefined) {
    selectedByKey.set(frameKey(available[0]), available[0])
  }
  if (endAnchorTimestamp === undefined) {
    selectedByKey.set(frameKey(available[available.length - 1]), available[available.length - 1])
  }

  let selected = [...selectedByKey.values()].sort((left, right) => {
    if (left.frame.timestamp !== right.frame.timestamp) {
      return left.frame.timestamp - right.frame.timestamp
    }
    return left.frame.sequenceNumber - right.frame.sequenceNumber
  })

  selected = await applyVisualThreshold(selected, visualThresholdPercent ?? 0)
  selected = capSelectedSnapshots(selected, normalizedMaxSnapshots)

  return selected
}

function findNearestFrame(
  sortedFrames: ActivityFrame[],
  timestamp: number,
): ActivityFrame | undefined {
  if (sortedFrames.length === 0) return undefined

  let lo = 0
  let hi = sortedFrames.length - 1
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const midTs = sortedFrames[mid].frame.timestamp
    if (midTs === timestamp) return sortedFrames[mid]
    if (midTs < timestamp) {
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  const right = sortedFrames[Math.min(lo, sortedFrames.length - 1)]
  const left = sortedFrames[Math.max(hi, 0)]
  const rightDelta = Math.abs(right.frame.timestamp - timestamp)
  const leftDelta = Math.abs(left.frame.timestamp - timestamp)
  if (leftDelta <= rightDelta) return left
  return right
}

function findFirstFrameAtOrAfter(
  sortedFrames: ActivityFrame[],
  timestamp: number,
): ActivityFrame | undefined {
  let lo = 0
  let hi = sortedFrames.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (sortedFrames[mid].frame.timestamp < timestamp) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo < sortedFrames.length ? sortedFrames[lo] : undefined
}

function findLastFrameAtOrBefore(
  sortedFrames: ActivityFrame[],
  timestamp: number,
): ActivityFrame | undefined {
  let lo = 0
  let hi = sortedFrames.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (sortedFrames[mid].frame.timestamp <= timestamp) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  const idx = lo - 1
  return idx >= 0 ? sortedFrames[idx] : undefined
}

async function applyVisualThreshold(
  frames: ActivityFrame[],
  visualThresholdPercent: number,
): Promise<ActivityFrame[]> {
  if (frames.length <= 2 || visualThresholdPercent <= 0) {
    return frames
  }

  const hashCache = new Map<string, string | null>()
  const getHash = async (filepath: string): Promise<string | null> => {
    if (!hashCache.has(filepath)) {
      hashCache.set(filepath, await loadImageDHash(filepath))
    }
    return hashCache.get(filepath) ?? null
  }

  const kept: ActivityFrame[] = [frames[0]]
  for (let i = 1; i < frames.length - 1; i++) {
    const previous = kept[kept.length - 1]
    const candidate = frames[i]
    const [leftHash, rightHash] = await Promise.all([
      getHash(previous.frame.filepath),
      getHash(candidate.frame.filepath),
    ])

    if (!leftHash || !rightHash) {
      kept.push(candidate)
      continue
    }

    const difference = dHashDifferencePercent(leftHash, rightHash)
    if (difference === null || difference >= visualThresholdPercent) {
      kept.push(candidate)
    }
  }

  const last = frames[frames.length - 1]
  const latestKept = kept[kept.length - 1]
  if (frameKey(latestKept) !== frameKey(last)) {
    const [leftHash, rightHash] = await Promise.all([
      getHash(latestKept.frame.filepath),
      getHash(last.frame.filepath),
    ])
    const difference = leftHash && rightHash ? dHashDifferencePercent(leftHash, rightHash) : null

    // Keep the timeline boundary frame, but avoid duplicate-looking tail pairs.
    if (difference !== null && difference < visualThresholdPercent && kept.length > 1) {
      kept[kept.length - 1] = last
    } else {
      kept.push(last)
    }
  }

  return kept
}

function capSelectedSnapshots(frames: ActivityFrame[], maxSnapshots: number): ActivityFrame[] {
  if (frames.length <= maxSnapshots) {
    return frames
  }

  const first = frames[0]
  const last = frames[frames.length - 1]
  const middle = frames.slice(1, -1)
  const middleSlots = Math.max(maxSnapshots - 2, 0)

  const result: ActivityFrame[] = [first]
  if (middleSlots > 0 && middle.length > 0) {
    const step = (middle.length - 1) / Math.max(middleSlots - 1, 1)
    for (let i = 0; i < middleSlots && i < middle.length; i++) {
      result.push(middle[Math.round(i * step)])
    }
  }

  if (maxSnapshots > 1) {
    result.push(last)
  }

  return dedupeFrames(result)
}

function dedupeFrames(frames: ActivityFrame[]): ActivityFrame[] {
  const seen = new Set<string>()
  const deduped: ActivityFrame[] = []
  for (const frame of frames) {
    const key = frameKey(frame)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(frame)
  }
  return deduped
}

function uniqueSortedTimestamps(values: number[]): number[] {
  const unique = [...new Set(values.filter((value) => Number.isFinite(value)))]
  unique.sort((left, right) => left - right)
  return unique
}

function frameKey(frame: ActivityFrame): string {
  return `${frame.frame.filepath}:${frame.frame.timestamp}:${frame.frame.sequenceNumber}`
}
