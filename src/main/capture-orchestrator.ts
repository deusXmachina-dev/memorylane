import log from './logger'
import type { UserContextBuilder } from './services/user-context-builder'
import type { CaptureStateManager } from './settings/capture-state-manager'
import type { RuntimeCapture } from './capture-controller'

export interface CaptureCoordinatorControls {
  isCapturingNow(): boolean
  requestStartCapture(): void
  requestStopCapture(): void
  /**
   * Temporarily pause capture for `durationMs`, then auto-resume. The persisted
   * capture preference stays enabled — this is an in-memory pause only, so an
   * app restart resumes capture. Re-pausing while paused replaces the timer.
   */
  pauseCapture(durationMs: number): void
  /** Resume immediately from a timed pause (clears the auto-resume timer). */
  resumeCapture(): void
  isUserPaused(): boolean
  getPauseState(): { pausedUntilMs: number | null }
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
  /**
   * Notifies the UI (tray + renderer) after a pause/resume so the displayed
   * state stays in sync even on paths with no direct caller (e.g. the
   * auto-resume timer firing). Optional so tests can omit it.
   */
  onStateChanged?: () => void
}): {
  controls: CaptureCoordinatorControls
  resumeCaptureIfDesired(reason: 'startup' | 'resume'): void
} {
  let pauseTimer: ReturnType<typeof setTimeout> | null = null
  let pausedUntilMs: number | null = null

  const scheduleBackgroundAnalyzers = (): void => {
    params.userContextBuilder?.scheduleRun()
    params.patternDetector?.scheduleRun()
  }

  const notifyStateChanged = (): void => {
    try {
      params.onStateChanged?.()
    } catch (error) {
      log.warn('[Main] capture onStateChanged listener threw:', error)
    }
  }

  const clearPauseTimer = (): void => {
    if (pauseTimer) {
      clearTimeout(pauseTimer)
      pauseTimer = null
    }
    pausedUntilMs = null
  }

  const isUserPaused = (): boolean => pausedUntilMs !== null

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
    // Starting un-pauses: a manual start overrides any active timed pause.
    clearPauseTimer()
    if (!persistCaptureEnabled(true)) return
    if (params.isPaused()) {
      log.info('[Main] Capture preference enabled while paused; will start on resume')
      return
    }
    params.capture.startCapture()
    scheduleBackgroundAnalyzers()
  }

  const requestStopCapture = (): void => {
    // Indefinite "turn off": cancel any timed pause so it can't auto-resume.
    clearPauseTimer()
    if (!persistCaptureEnabled(false)) return
    void params.capture.forceClose()
    params.capture.stopCapture()
  }

  // Resume from a timed pause: start capture if it's still the desired state.
  // Used both by the manual "resume now" control and by the auto-resume timer.
  const resumeCapture = (): void => {
    clearPauseTimer()
    if (!params.captureStateManager.isCaptureEnabled()) {
      notifyStateChanged()
      return
    }
    if (!params.capture.isCapturingNow() && !params.isPaused()) {
      log.info('[Main] Resuming capture from timed pause')
      params.capture.startCapture()
      scheduleBackgroundAnalyzers()
    }
    notifyStateChanged()
  }

  const pauseCapture = (durationMs: number): void => {
    const clamped = Number.isFinite(durationMs) && durationMs > 0 ? Math.floor(durationMs) : 0
    if (clamped <= 0) return

    if (pauseTimer) clearTimeout(pauseTimer)
    pausedUntilMs = Date.now() + clamped
    pauseTimer = setTimeout(() => {
      pauseTimer = null
      pausedUntilMs = null
      resumeCapture()
    }, clamped)
    pauseTimer.unref?.()

    // Keep the persisted preference enabled — the intent stays "capture on",
    // we're only taking a break. Halt capture now.
    void params.capture.forceClose()
    params.capture.stopCapture()
    log.info(`[Main] Capture paused for ${Math.round(clamped / 1000)}s`)
    notifyStateChanged()
  }

  const stopCaptureForShutdown = (): void => {
    clearPauseTimer()
    params.capture.stopCapture()
  }

  const resumeCaptureIfDesired = (reason: 'startup' | 'resume'): void => {
    if (!params.captureStateManager.isCaptureEnabled()) return
    // A timed pause is in-memory: on startup there is none, but on power-resume
    // an active pause must win so unlocking doesn't cut a pause short.
    if (isUserPaused()) return
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
      pauseCapture,
      resumeCapture,
      isUserPaused,
      getPauseState: () => ({ pausedUntilMs }),
      stopCaptureForShutdown,
      forceClose: () => params.capture.forceClose(),
      updateActivityWindowConfig: (input) => params.capture.updateActivityWindowConfig(input),
    },
    resumeCaptureIfDesired,
  }
}
