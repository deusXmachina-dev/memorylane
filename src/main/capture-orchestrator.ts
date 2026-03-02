import log from './logger'
import type { ActivityManager } from './processor/activity-manager'
import type { CaptureStateManager } from './settings/capture-state-manager'

export interface CaptureCoordinatorControls {
  isCapturingNow(): boolean
  requestStartCapture(): void
  requestStopCapture(): void
  stopCaptureForShutdown(): void
  forceClose(): Promise<void>
}

export function createCaptureCoordinator(params: {
  recorder: {
    isCapturingNow: () => boolean
    startCapture: () => void
    stopCapture: () => void
  }
  activityManager: ActivityManager
  captureStateManager: CaptureStateManager
  isPaused: () => boolean
}): {
  controls: CaptureCoordinatorControls
  resumeCaptureIfDesired(reason: 'startup' | 'resume'): void
} {
  const persistCaptureEnabled = (enabled: boolean): boolean => {
    try {
      params.captureStateManager.setCaptureEnabled(enabled)
      return true
    } catch (error) {
      log.error('[Main] Failed to persist capture preference:', error)
      return false
    }
  }

  const requestStartCapture = (): void => {
    if (!persistCaptureEnabled(true)) return
    if (params.isPaused()) {
      log.info('[Main] Capture preference enabled while paused; will start on resume')
      return
    }
    params.recorder.startCapture()
  }

  const requestStopCapture = (): void => {
    if (!persistCaptureEnabled(false)) return
    void params.activityManager.forceClose()
    params.recorder.stopCapture()
  }

  const stopCaptureForShutdown = (): void => {
    params.recorder.stopCapture()
  }

  const resumeCaptureIfDesired = (reason: 'startup' | 'resume'): void => {
    if (!params.captureStateManager.isCaptureEnabled()) return
    if (params.recorder.isCapturingNow() || params.isPaused()) return

    log.info(`[Main] Starting capture from persisted preference (${reason})`)
    params.recorder.startCapture()
  }

  return {
    controls: {
      isCapturingNow: () => params.recorder.isCapturingNow(),
      requestStartCapture,
      requestStopCapture,
      stopCaptureForShutdown,
      forceClose: () => params.activityManager.forceClose(),
    },
    resumeCaptureIfDesired,
  }
}
