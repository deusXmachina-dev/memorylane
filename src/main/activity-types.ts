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
  // leaking across an app boundary). Kill-switch: set false to disable the
  // filter without a native rebuild. Unstamped frames are always kept.
  enableFrameAppFilter: boolean
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
    enableFrameAppFilter: true,
  }
}
