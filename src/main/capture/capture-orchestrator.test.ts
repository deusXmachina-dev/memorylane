import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCaptureCoordinator } from './capture-orchestrator'

function createHarnessMock() {
  return {
    capturing: vi.fn().mockReturnValue(false),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    flushEvents: vi.fn().mockResolvedValue(undefined),
    updateActivityWindowConfig: vi.fn(),
  }
}

function createCaptureStateManagerMock() {
  return {
    setCaptureEnabled: vi.fn(),
    isCaptureEnabled: vi.fn().mockReturnValue(true),
  }
}

describe('createCaptureCoordinator', () => {
  it('schedules background analyzers on manual start when not paused', () => {
    const harness = createHarnessMock()
    const stateManager = createCaptureStateManagerMock()
    const userContextBuilder = { scheduleRun: vi.fn() }

    const coordinator = createCaptureCoordinator({
      harness,
      captureStateManager: stateManager as never,
      isPaused: () => false,
      userContextBuilder: userContextBuilder as never,
    })

    coordinator.controls.requestStartCapture()

    expect(stateManager.setCaptureEnabled).toHaveBeenCalledWith(true)
    expect(harness.start).toHaveBeenCalledTimes(1)
    expect(userContextBuilder.scheduleRun).toHaveBeenCalledTimes(1)
  })

  it('persists the preference on manual start while paused and defers the start', () => {
    const harness = createHarnessMock()
    const stateManager = createCaptureStateManagerMock()
    const userContextBuilder = { scheduleRun: vi.fn() }
    const onStateChanged = vi.fn()

    const coordinator = createCaptureCoordinator({
      harness,
      captureStateManager: stateManager as never,
      isPaused: () => true,
      userContextBuilder: userContextBuilder as never,
      onStateChanged,
    })

    coordinator.controls.requestStartCapture()

    expect(stateManager.setCaptureEnabled).toHaveBeenCalledWith(true)
    expect(harness.start).not.toHaveBeenCalled()
    expect(userContextBuilder.scheduleRun).not.toHaveBeenCalled()
    expect(onStateChanged).toHaveBeenCalledTimes(1)
  })

  it('keeps scheduling behavior on resume path', () => {
    const harness = createHarnessMock()
    const stateManager = createCaptureStateManagerMock()
    const userContextBuilder = { scheduleRun: vi.fn() }

    const coordinator = createCaptureCoordinator({
      harness,
      captureStateManager: stateManager as never,
      isPaused: () => false,
      userContextBuilder: userContextBuilder as never,
    })

    coordinator.resumeCaptureIfDesired('resume')

    expect(harness.start).toHaveBeenCalledTimes(1)
    expect(userContextBuilder.scheduleRun).toHaveBeenCalledTimes(1)
  })
})

describe('createCaptureCoordinator timed pause', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeCoordinator(overrides?: { isPaused?: () => boolean }) {
    const harness = createHarnessMock()
    const stateManager = createCaptureStateManagerMock()
    const onStateChanged = vi.fn()
    const coordinator = createCaptureCoordinator({
      harness,
      captureStateManager: stateManager as never,
      isPaused: overrides?.isPaused ?? (() => false),
      userContextBuilder: { scheduleRun: vi.fn() } as never,
      onStateChanged,
    })
    return { harness, stateManager, onStateChanged, coordinator }
  }

  it('stops capture and records a deadline without disabling the preference', () => {
    const { harness, stateManager, onStateChanged, coordinator } = makeCoordinator()

    coordinator.controls.pauseCapture(30 * 60_000)

    expect(harness.stop).toHaveBeenCalledTimes(1)
    expect(stateManager.setCaptureEnabled).not.toHaveBeenCalled()
    expect(coordinator.controls.isUserPaused()).toBe(true)
    expect(coordinator.controls.getPauseState().pausedUntilMs).not.toBeNull()
    expect(onStateChanged).toHaveBeenCalledTimes(1)
  })

  it('auto-resumes capture when the timer elapses', () => {
    const { harness, coordinator } = makeCoordinator()

    coordinator.controls.pauseCapture(30 * 60_000)
    expect(harness.start).not.toHaveBeenCalled()

    vi.advanceTimersByTime(30 * 60_000)

    expect(harness.start).toHaveBeenCalledTimes(1)
    expect(coordinator.controls.isUserPaused()).toBe(false)
    expect(coordinator.controls.getPauseState().pausedUntilMs).toBeNull()
  })

  it('resumes after the deadline even if the sweep was suspended during sleep', () => {
    const { harness, coordinator } = makeCoordinator()

    coordinator.controls.pauseCapture(30 * 60_000)
    expect(harness.start).not.toHaveBeenCalled()

    // Simulate the Mac sleeping past the deadline: the wall clock jumps forward
    // by more than the pause duration while the sweep interval never ticks.
    vi.setSystemTime(Date.now() + 2 * 60 * 60_000)
    // The first sweep tick after wake compares the absolute deadline and resumes.
    vi.advanceTimersByTime(15_000)

    expect(harness.start).toHaveBeenCalledTimes(1)
    expect(coordinator.controls.isUserPaused()).toBe(false)
    expect(coordinator.controls.getPauseState().pausedUntilMs).toBeNull()
  })

  it('resumeCapture starts capture immediately and cancels the sweep', () => {
    const { harness, coordinator } = makeCoordinator()

    coordinator.controls.pauseCapture(30 * 60_000)
    coordinator.controls.resumeCapture()

    expect(harness.start).toHaveBeenCalledTimes(1)
    expect(coordinator.controls.isUserPaused()).toBe(false)

    // Timer must not fire a second start after a manual resume.
    vi.advanceTimersByTime(30 * 60_000)
    expect(harness.start).toHaveBeenCalledTimes(1)
  })

  it('requestStopCapture cancels an active pause and disables the preference', () => {
    const { stateManager, coordinator } = makeCoordinator()

    coordinator.controls.pauseCapture(30 * 60_000)
    coordinator.controls.requestStopCapture()

    expect(coordinator.controls.isUserPaused()).toBe(false)
    expect(stateManager.setCaptureEnabled).toHaveBeenCalledWith(false)
  })

  it('resumeCaptureIfDesired does not override an active pause', () => {
    const { harness, coordinator } = makeCoordinator()

    coordinator.controls.pauseCapture(30 * 60_000)
    coordinator.resumeCaptureIfDesired('resume')

    expect(harness.start).not.toHaveBeenCalled()
    expect(coordinator.controls.isUserPaused()).toBe(true)
  })

  it('suspendCapture stops a running capture without changing the preference', () => {
    const { harness, stateManager, onStateChanged, coordinator } = makeCoordinator()
    harness.capturing.mockReturnValue(true)

    coordinator.suspendCapture('device not activated')

    expect(harness.stop).toHaveBeenCalledTimes(1)
    expect(stateManager.setCaptureEnabled).not.toHaveBeenCalled()
    expect(onStateChanged).toHaveBeenCalledTimes(1)
  })

  it('suspendCapture only refreshes the UI when capture is not running', () => {
    const { harness, onStateChanged, coordinator } = makeCoordinator()

    coordinator.suspendCapture('device not activated')

    expect(harness.flushEvents).not.toHaveBeenCalled()
    expect(harness.stop).not.toHaveBeenCalled()
    expect(onStateChanged).toHaveBeenCalledTimes(1)
  })

  it('resumeCaptureIfDesired restarts capture after reactivation when still desired', () => {
    const { harness, onStateChanged, coordinator } = makeCoordinator()

    coordinator.resumeCaptureIfDesired('reactivated')

    expect(harness.start).toHaveBeenCalledTimes(1)
    expect(onStateChanged).toHaveBeenCalledTimes(1)
  })

  it('resumeCaptureIfDesired does not start while the device still requires activation', () => {
    const { harness, onStateChanged, coordinator } = makeCoordinator({ isPaused: () => true })

    coordinator.resumeCaptureIfDesired('startup')
    coordinator.resumeCaptureIfDesired('reactivated')

    expect(harness.start).not.toHaveBeenCalled()
    expect(onStateChanged).toHaveBeenCalledTimes(2)
  })
})
