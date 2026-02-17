/**
 * Segment orchestrator.
 *
 * Wires app-watcher events (via interaction monitor) to video recorder
 * segment splits. On each app/window change, triggers a split on the
 * relevant display. When segments complete, attaches the app context
 * and forwards to registered callbacks.
 */

import type { VideoSegment, InteractionContext } from '../../shared/types'
import * as videoRecorder from './video-recorder'
import * as interactionMonitor from './interaction-monitor'
import log from '../logger'

export interface SegmentContext {
  appName?: string
  windowTitle?: string
  url?: string
}

type OnSegmentWithContextCallback = (segment: VideoSegment, context: SegmentContext) => void

let running = false
const callbacks: OnSegmentWithContextCallback[] = []

// Track the most recent app context per display so we can attach it
// when a segment_complete event arrives (which is asynchronous).
const displayContext: Map<number, SegmentContext> = new Map()

function handleInteraction(event: InteractionContext): void {
  if (event.type !== 'app_change') return
  if (!event.displayId) return

  // Capture the *previous* window context — the segment being finalized
  // represents the time spent in the previous app.
  const context: SegmentContext = {
    appName: event.previousWindow?.processName,
    windowTitle: event.previousWindow?.title,
    url: event.previousWindow?.url,
  }

  displayContext.set(event.displayId, context)

  log.info(
    `[SegmentOrchestrator] App change on display ${event.displayId}: ` +
      `${context.appName ?? '(unknown)'} → ${event.activeWindow?.processName ?? '(unknown)'}`,
  )

  videoRecorder.split(event.displayId)
}

function handleSegment(segment: VideoSegment): void {
  const context = displayContext.get(segment.displayId) ?? {}
  displayContext.delete(segment.displayId)

  log.info(
    `[SegmentOrchestrator] Segment ready: ${segment.filepath} ` +
      `app=${context.appName ?? '(none)'} title="${context.windowTitle ?? ''}"`,
  )

  callbacks.forEach((cb) => {
    try {
      cb(segment, context)
    } catch (err) {
      log.error('[SegmentOrchestrator] Error in segment callback:', err)
    }
  })
}

/**
 * Start the orchestrator: begins continuous video recording and listens
 * for app-change events to trigger segment splits.
 */
export async function start(): Promise<void> {
  if (running) {
    log.warn('[SegmentOrchestrator] Already running')
    return
  }

  running = true

  // Register for segment completion events
  videoRecorder.onSegment(handleSegment)

  // Start continuous recording
  await videoRecorder.start()

  // Listen for app-change interactions to trigger splits
  interactionMonitor.onInteraction(handleInteraction)

  log.info('[SegmentOrchestrator] Started')
}

/**
 * Stop the orchestrator: stops recording and unregisters callbacks.
 */
export async function stop(): Promise<void> {
  if (!running) return

  running = false

  interactionMonitor.clearInteractionCallback(handleInteraction)
  await videoRecorder.stop()
  displayContext.clear()

  log.info('[SegmentOrchestrator] Stopped')
}

/**
 * Register a callback for completed segments with app context.
 */
export function onSegment(callback: OnSegmentWithContextCallback): void {
  callbacks.push(callback)
}

/**
 * Whether the orchestrator is currently running.
 */
export function isRunning(): boolean {
  return running
}
