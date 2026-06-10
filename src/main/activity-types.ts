import type { EventWindow, InteractionContext } from '../shared/types'
import type { Frame } from './recorder/screen-capturer'
import type { Offset } from './streams/stream'
import { ACTIVITY_CONFIG } from '../shared/constants'

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

export interface ActivityProducerConfig {
  frameJoinGraceMs: number
  maxFrameWaitMs: number
  minActivityDurationMs: number
  maxActivityDurationMs: number
  frameBufferRetentionMs: number
  eventConsumerId: string
  frameConsumerId: string
  // When true, a frame stamped with a frontmost app that doesn't match a
  // window's derived context is kept out of that window (stops screenshots
  // leaking across an app boundary). Unstamped frames are always kept, and the
  // filter never applies to fallback-derived contexts. Kill-switch: set
  // MEMORYLANE_DISABLE_FRAME_APP_FILTER to disable without a rebuild.
  enableFrameAppFilter: boolean
  // When true, drop an activity's last frame when it's finalized because a
  // different app took over and that frame was captured within
  // TRAILING_FRAME_DROP_WINDOW_MS of the switch — the sub-second skew between
  // screen compositing and the frontmost-app signal makes such a frame tend to
  // already show the *next* app (a one-frame "transition bleed"). Never empties
  // an activity. Kill-switch: set MEMORYLANE_DISABLE_TRAILING_FRAME_DROP to
  // disable without a rebuild.
  dropAppSwitchTrailingFrame: boolean
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
    enableFrameAppFilter: !process.env.MEMORYLANE_DISABLE_FRAME_APP_FILTER,
    dropAppSwitchTrailingFrame: !process.env.MEMORYLANE_DISABLE_TRAILING_FRAME_DROP,
  }
}
