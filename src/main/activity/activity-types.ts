import type { EventWindow, InteractionContext } from '@/shared/types'
import type { Frame } from '@main/recorder/screen-capturer'
import type { Offset } from '@main/streams/stream'
import { ACTIVITY_CONFIG, BOUNDARY_TRIM_CONFIG } from '@constants'

export interface ActivityFrame {
  offset: Offset
  frame: Frame
}

export interface ActivityContext {
  appName: string
  bundleId?: string
  windowTitle?: string
  url?: string
  tld?: string
  displayId?: number
}

export interface ActivityProvenance {
  eventWindowOffsets: Offset[]
  frameOffsets: Offset[]
  sourceWindowIds: string[]
  sourceClosedBy: EventWindow['closedBy'][]
}

export interface Activity {
  id: string
  startTimestamp: number
  endTimestamp: number
  context: ActivityContext
  interactions: InteractionContext[]
  frames: ActivityFrame[]
  provenance: ActivityProvenance
}

/** Why the producer discarded a window/activity instead of emitting it. */
export type DroppedActivityReason = 'too_short' | 'no_frames' | 'unknown_context'

/**
 * A window/activity the producer formed but did NOT emit, surfaced (opt-in via
 * `onActivityDropped`) for diagnostics and eval transcripts. Production ignores
 * it; the eval replay collects it to render `DROPPED` blocks in golden.md.
 */
export interface DroppedActivityInfo {
  reason: DroppedActivityReason
  startTimestamp: number
  endTimestamp: number
  appName?: string
  windowTitle?: string
  tld?: string
  /** Human-readable detail for debugging, e.g. "2193ms < 3000ms (context_change)". */
  detail: string
}

export interface ActivityProducerConfig {
  frameJoinGraceMs: number
  maxFrameWaitMs: number
  minActivityDurationMs: number
  maxActivityDurationMs: number
  frameBufferRetentionMs: number
  eventConsumerId: string
  frameConsumerId: string
  enableBoundaryTrim: boolean
  /** Optional sink for dropped windows/activities. No-op in production. */
  onActivityDropped?: (info: DroppedActivityInfo) => void
}

export function createDefaultActivityProducerConfig(): ActivityProducerConfig {
  return {
    frameJoinGraceMs: 750,
    maxFrameWaitMs: 5_000,
    minActivityDurationMs: ACTIVITY_CONFIG.MIN_ACTIVITY_DURATION_MS,
    maxActivityDurationMs: ACTIVITY_CONFIG.MAX_ACTIVITY_DURATION_MS,
    frameBufferRetentionMs: ACTIVITY_CONFIG.MAX_ACTIVITY_DURATION_MS * 2,
    eventConsumerId: 'activity-producer:event-stream',
    frameConsumerId: 'activity-producer:frame-stream',
    enableBoundaryTrim: BOUNDARY_TRIM_CONFIG.ENABLED,
  }
}
