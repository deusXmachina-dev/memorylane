import { CaptureSession, InteractionContext, Screenshot } from '../shared/types'
import log from './logger'

export type CapturePipelineMode = 'session' | 'screenshot'

export interface CapturePipelineHooks {
  onProcessed: () => void
  onProcessingError: (itemId: string, error: unknown) => void
}

export interface SessionRecorderLike {
  onSessionComplete?: ((callback: (session: CaptureSession) => void) => void) | undefined
}

export interface ScreenshotRecorderLike {
  onScreenshot?: ((callback: (screenshot: Screenshot) => void) => void) | undefined
}

export interface SessionProcessorLike {
  processSession?: ((session: CaptureSession) => Promise<void>) | undefined
}

export interface ScreenshotProcessorLike {
  processScreenshot?: ((screenshot: Screenshot) => Promise<void>) | undefined
  addInteractionEvent?: ((event: InteractionContext) => void) | undefined
}

export interface InteractionMonitorLike {
  onInteraction: (callback: (event: InteractionContext) => void) => void
}

export interface WireCapturePipelineParams {
  recorder: SessionRecorderLike & ScreenshotRecorderLike
  processor: SessionProcessorLike & ScreenshotProcessorLike
  interactionMonitor: InteractionMonitorLike
  hooks: CapturePipelineHooks
}

function canUseSessionPipeline(
  recorder: SessionRecorderLike,
  processor: SessionProcessorLike,
): boolean {
  return (
    typeof recorder.onSessionComplete === 'function' &&
    typeof processor.processSession === 'function'
  )
}

function canUseScreenshotPipeline(
  recorder: ScreenshotRecorderLike,
  processor: ScreenshotProcessorLike,
): boolean {
  return (
    typeof recorder.onScreenshot === 'function' && typeof processor.processScreenshot === 'function'
  )
}

/**
 * Wires recorder output into processor input.
 *
 * Prefers session mode when available (`onSessionComplete` + `processSession`), and
 * falls back to the legacy screenshot mode for backward compatibility.
 */
export function wireCapturePipeline({
  recorder,
  processor,
  interactionMonitor,
  hooks,
}: WireCapturePipelineParams): CapturePipelineMode {
  if (canUseSessionPipeline(recorder, processor)) {
    const onSessionComplete = recorder.onSessionComplete
    const processSession = processor.processSession
    if (!onSessionComplete || !processSession) {
      throw new Error('Session pipeline wiring failed: incomplete session handlers.')
    }

    onSessionComplete((session) => {
      log.info(`[Main] Session completed: ${session.sessionId} (${session.endReason})`)
      void processSession(session)
        .then(() => {
          hooks.onProcessed()
        })
        .catch((error) => {
          hooks.onProcessingError(session.sessionId, error)
        })
    })
    return 'session'
  }

  if (canUseScreenshotPipeline(recorder, processor)) {
    const onScreenshot = recorder.onScreenshot
    const processScreenshot = processor.processScreenshot
    if (!onScreenshot || !processScreenshot) {
      throw new Error('Screenshot pipeline wiring failed: incomplete screenshot handlers.')
    }

    onScreenshot((screenshot) => {
      log.info(`[Main] Screenshot captured: ${screenshot.id}`)
      void processScreenshot(screenshot)
        .then(() => {
          hooks.onProcessed()
        })
        .catch((error) => {
          hooks.onProcessingError(screenshot.id, error)
        })
    })

    if (typeof processor.addInteractionEvent === 'function') {
      interactionMonitor.onInteraction((event) => {
        processor.addInteractionEvent(event)
      })
    }

    return 'screenshot'
  }

  throw new Error(
    'Unable to wire capture pipeline: expected either session APIs ' +
      '(onSessionComplete + processSession) or screenshot APIs ' +
      '(onScreenshot + processScreenshot).',
  )
}
