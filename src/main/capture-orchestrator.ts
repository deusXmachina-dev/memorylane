import log from './logger'
import type { UserContextBuilder } from './services/user-context-builder'
import type { CaptureStateManager } from './settings/capture-state-manager'
import type { RuntimeCapture } from './capture-controller'

export interface CaptureCoordinatorControls {
  isCapturingNow(): boolean
  requestStartCapture(): void
  requestStopCapture(): void
  stopCaptureForShutdown(): void
  forceClose(): Promise<void>
  updateActivityWindowConfig(input: {
    minActivityDurationMs: number
    maxActivityDurationMs: number
  }): void
}

export function createCaptureCoordinator(params: {
  capture: RuntimeCapture
  captureStateManager: CaptureStateManager
  isPaused: () => boolean
  userContextBuilder: UserContextBuilder | null
  /**
   * The scheduled background miner. Structural so either PatternDetector or
   * TaskMiner (selected by the ML_TASK_MINING flag) can be passed in.
   */
  patternDetector: { scheduleRun(): void } | null
}): {
  controls: CaptureCoordinatorControls
  resumeCaptureIfDesired(reason: 'startup' | 'resume'): void
} {
  const scheduleBackgroundAnalyzers = (): void => {
    params.userContextBuilder?.scheduleRun()
    params.patternDetector?.scheduleRun()
  }

  const persistCaptureEnabled = (enabled: boolean): boolean => {
    try {
      params.captureStateManager.setCaptureEnabled(enabled)
      return true
    } catch (error) {
      log.error(`[Main] Failed to persist capture preference (enabled=${enabled}):`, error)
      return false
    }
  }

  const requestStartCapture = (): void => {
    if (!persistCaptureEnabled(true)) return
    if (params.isPaused()) {
      log.info('[Main] Capture preference enabled while paused; will start on resume')
      return
    }
    params.capture.startCapture()
    scheduleBackgroundAnalyzers()
  }

  const requestStopCapture = (): void => {
    if (!persistCaptureEnabled(false)) return
    void params.capture.forceClose()
    params.capture.stopCapture()
  }

  const stopCaptureForShutdown = (): void => {
    params.capture.stopCapture()
  }

  const resumeCaptureIfDesired = (reason: 'startup' | 'resume'): void => {
    if (!params.captureStateManager.isCaptureEnabled()) return
    if (params.capture.isCapturingNow() || params.isPaused()) return

    log.info(`[Main] Starting capture from persisted preference (${reason})`)
    params.capture.startCapture()

    scheduleBackgroundAnalyzers()
  }

  return {
    controls: {
      isCapturingNow: () => params.capture.isCapturingNow(),
      requestStartCapture,
      requestStopCapture,
      stopCaptureForShutdown,
      forceClose: () => params.capture.forceClose(),
      updateActivityWindowConfig: (input) => params.capture.updateActivityWindowConfig(input),
    },
    resumeCaptureIfDesired,
  }
}
