import { BOUNDARY_TRIM_CONFIG } from '@constants'
import { loadImageLuminance, luminanceL1DifferencePercent } from '@main/semantic/visual-diff'
import type { ActivityFrame } from './activity-types'

export interface BoundaryTrimResult {
  framesToDrop: ActivityFrame[]
}

export interface BoundaryTrimParams {
  frames: ActivityFrame[]
  afterFrames: ActivityFrame[]
  candidateCount?: number
  referenceCount?: number
  minLeakMarginPercent?: number
}

// Comparison resolution. Small enough that a resize is cheap, large enough
// that window layout survives; calibration on real boundary captures gave
// identical verdicts from 32x18 up to 160x90.
const LUMINANCE_WIDTH = 96
const LUMINANCE_HEIGHT = 54

const NO_TRIM: BoundaryTrimResult = { framesToDrop: [] }

/**
 * Detects trailing frames that leaked across an app boundary. The real app
 * switch precedes the observer notification, so the last frame(s) of an
 * activity can visually show the next app while falling inside this
 * activity's time range.
 *
 * Decision rule is purely relative — absolute similarity thresholds don't
 * work because in-app visual churn varies wildly by app (a scrolling
 * terminal changes more per second than an app switch changes some screens).
 * A trailing frame is dropped iff its downsampled-luminance L1 distance to
 * the frames captured after the boundary (which reliably show the new app)
 * is meaningfully smaller than its distance to the frames in the body of its
 * own activity. dHash is deliberately not used here: its comparator bits are
 * JPEG-noise coin flips on flat dark UI regions, so two captures of the same
 * dark-themed screen can hash ~50% apart.
 *
 * Only a contiguous tail is trimmed, the activity is never emptied, and any
 * load failure fails open (frame kept).
 */
export async function detectTrailingLeakFrames(
  params: BoundaryTrimParams,
): Promise<BoundaryTrimResult> {
  const { frames, afterFrames } = params
  const candidateCount = params.candidateCount ?? BOUNDARY_TRIM_CONFIG.CANDIDATE_COUNT
  const referenceCount = params.referenceCount ?? BOUNDARY_TRIM_CONFIG.REFERENCE_COUNT
  const minLeakMarginPercent =
    params.minLeakMarginPercent ?? BOUNDARY_TRIM_CONFIG.MIN_LEAK_MARGIN_PERCENT

  if (frames.length <= 1) return NO_TRIM
  if (afterFrames.length === 0) return NO_TRIM

  const luminanceCache = new Map<string, Promise<Uint8Array | null>>()
  const luminanceOf = (frame: ActivityFrame): Promise<Uint8Array | null> => {
    let cached = luminanceCache.get(frame.frame.filepath)
    if (cached === undefined) {
      cached = loadImageLuminance(frame.frame.filepath, LUMINANCE_WIDTH, LUMINANCE_HEIGHT)
      luminanceCache.set(frame.frame.filepath, cached)
    }
    return cached
  }

  const minDistance = async (
    candidateLuminance: Uint8Array,
    references: ActivityFrame[],
  ): Promise<number | null> => {
    let min: number | null = null
    for (const reference of references) {
      const referenceLuminance = await luminanceOf(reference)
      if (referenceLuminance === null) continue
      const difference = luminanceL1DifferencePercent(candidateLuminance, referenceLuminance)
      if (difference === null) continue
      if (min === null || difference < min) min = difference
    }
    return min
  }

  const candidates = frames.slice(-Math.min(candidateCount, frames.length - 1))
  const ownReferences = frames.slice(0, frames.length - candidates.length).slice(-referenceCount)
  const afterReferences = afterFrames.slice(0, referenceCount)
  if (ownReferences.length === 0) return NO_TRIM

  const framesToDrop: ActivityFrame[] = []
  for (const candidate of [...candidates].reverse()) {
    const candidateLuminance = await luminanceOf(candidate)
    if (candidateLuminance === null) break
    const distanceToAfter = await minDistance(candidateLuminance, afterReferences)
    const distanceToOwn = await minDistance(candidateLuminance, ownReferences)
    if (distanceToAfter === null || distanceToOwn === null) break
    if (distanceToAfter - distanceToOwn >= -minLeakMarginPercent) break
    framesToDrop.unshift(candidate)
  }
  return framesToDrop.length > 0 ? { framesToDrop } : NO_TRIM
}
