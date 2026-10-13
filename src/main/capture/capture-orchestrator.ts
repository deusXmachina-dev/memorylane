import log from '@main/utils/logger'
import type { UserContextBuilder } from '@main/services/user-context-builder'
import type { CaptureStateManager } from '@main/settings/capture-state-manager'
import type { PipelineHarness } from '@main/activity/pipeline-harness'

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

type CaptureHarness = Pick<
  PipelineHarness,
  'capturing' | 'start' | 'stop' | 'flushEvents' | 'updateActivityWindowConfig'
>

export function createCaptureCoordinator(params: {
  harness: CaptureHarness
  captureStateManager: CaptureStateManager
  isPaused: () => boolean
  userContextBuilder: UserContextBuilder | null
  /**
   * Notifies the UI (tray + renderer) after any capture-state transition
   * (start/stop/pause/resume) so the displayed state stays in sync — including
   * on paths with no direct caller (e.g. the auto-resume timer firing). This is
   * the single sync point: callers should not refresh the tray/renderer
   * themselves. Optional so tests can omit it.
   */
  onStateChanged?: () => void
}): {
  controls: CaptureCoordinatorControls
  resumeCaptureIfDesired(reason: 'startup' | 'resume' | 'reactivated'): void
  suspendCapture(reason: string): void
} {
  // How often the sweep checks whether a pause deadline has passed.
  const SWEEP_INTERVAL_MS = 15_000
  let pauseSweep: ReturnType<typeof setInterval> | null = null
  // Absolute wall-clock deadline (epoch ms) at which capture auto-resumes, or
  // null when not paused. Stored as a real timestamp so system sleep can't cut
  // the pause short or overrun it — the sweep compares it against Date.now().
  let pausedUntilMs: number | null = null

  const scheduleBackgroundAnalyzers = (): void => {
    params.userContextBuilder?.scheduleRun()
  }

  const notifyStateChanged = (): void => {
    try {
      params.onStateChanged?.()
    } catch (error) {
      log.warn('[Main] capture onStateChanged listener threw:', error)
    }
  }

  const startCapture = (): void => {
    void params.harness.start().catch((error) => {
      log.error('[Main] Failed to start capture:', error)
      notifyStateChanged()
    })
  }

  const stopCapture = (): void => {
    void params.harness.flushEvents()
    void params.harness.stop().catch((error) => {
      log.error('[Main] Failed to stop capture:', error)
    })
  }

  const clearPauseSweep = (): void => {
    if (pauseSweep) {
      clearInterval(pauseSweep)
      pauseSweep = null
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
    clearPauseSweep()
    if (!persistCaptureEnabled(true)) {
      notifyStateChanged()
      return
    }
    if (params.isPaused()) {
      log.info('[Main] Capture preference enabled while paused; will start on resume')
      notifyStateChanged()
      return
    }
    startCapture()
    scheduleBackgroundAnalyzers()
    notifyStateChanged()
  }

  const requestStopCapture = (): void => {
    // Indefinite "turn off": cancel any timed pause so it can't auto-resume.
    clearPauseSweep()
    if (!persistCaptureEnabled(false)) {
      notifyStateChanged()
      return
    }
    stopCapture()
    notifyStateChanged()
  }

  // Resume from a timed pause: start capture if it's still the desired state.
  // Used both by the manual "resume now" control and by the auto-resume timer.
  const resumeCapture = (): void => {
    clearPauseSweep()
    if (!params.captureStateManager.isCaptureEnabled()) {
      notifyStateChanged()
      return
    }
    if (!params.harness.capturing() && !params.isPaused()) {
      log.info('[Main] Resuming capture from timed pause')
      startCapture()
      scheduleBackgroundAnalyzers()
    }
    notifyStateChanged()
  }

  const pauseCapture = (durationMs: number): void => {
    const clamped = Number.isFinite(durationMs) && durationMs > 0 ? Math.floor(durationMs) : 0
    if (clamped <= 0) return

    // Record an absolute future deadline, then sweep until real time reaches it.
    // Unlike a one-shot setTimeout (suspended during sleep, so it fires late),
    // comparing Date.now() each tick keeps the pause accurate across sleep.
    if (pauseSweep) clearInterval(pauseSweep)
    pausedUntilMs = Date.now() + clamped
    pauseSweep = setInterval(() => {
      if (pausedUntilMs !== null && Date.now() >= pausedUntilMs) {
        resumeCapture()
      }
    }, SWEEP_INTERVAL_MS)
    pauseSweep.unref?.()

    // Keep the persisted preference enabled — the intent stays "capture on",
    // we're only taking a break. Halt capture now.
    stopCapture()
    log.info(`[Main] Capture paused for ${Math.round(clamped / 1000)}s`)
    notifyStateChanged()
  }

  const stopCaptureForShutdown = (): void => {
    clearPauseSweep()
    void params.harness.stop().catch((error) => {
      log.error('[Main] Failed to stop capture:', error)
    })
  }

  const suspendCapture = (reason: string): void => {
    if (params.harness.capturing()) {
      log.info(`[Main] Pausing capture (${reason})`)
      stopCapture()
    }
    notifyStateChanged()
  }

  const resumeCaptureIfDesired = (reason: 'startup' | 'resume' | 'reactivated'): void => {
    const desired =
      params.captureStateManager.isCaptureEnabled() &&
      // A timed pause is in-memory: on startup there is none, but on power-resume
      // an active pause must win so unlocking doesn't cut a pause short.
      !isUserPaused() &&
      !params.harness.capturing() &&
      !params.isPaused()
    if (desired) {
      log.info(`[Main] Starting capture from persisted preference (${reason})`)
      startCapture()
      scheduleBackgroundAnalyzers()
    }
    notifyStateChanged()
  }

  return {
    controls: {
      isCapturingNow: () => params.harness.capturing(),
      requestStartCapture,
      requestStopCapture,
      pauseCapture,
      resumeCapture,
      isUserPaused,
      getPauseState: () => ({ pausedUntilMs }),
      stopCaptureForShutdown,
      forceClose: () => params.harness.flushEvents(),
      updateActivityWindowConfig: (input) => params.harness.updateActivityWindowConfig(input),
    },
    resumeCaptureIfDesired,
    suspendCapture,
  }
}
