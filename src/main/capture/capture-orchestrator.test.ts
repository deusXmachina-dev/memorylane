import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCaptureCoordinator } from './capture-orchestrator'

function createCaptureMock() {
  return {
    isCapturingNow: vi.fn().mockReturnValue(false),
    startCapture: vi.fn(),
    stopCapture: vi.fn(),
    forceClose: vi.fn().mockResolvedValue(undefined),
    getScreenshotsDir: vi.fn().mockReturnValue('/tmp'),
    setFrameCaptureSuppressed: vi.fn(),
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
    const capture = createCaptureMock()
    const stateManager = createCaptureStateManagerMock()
    const userContextBuilder = { scheduleRun: vi.fn() }
    const taskMiner = { scheduleRun: vi.fn() }

    const coordinator = createCaptureCoordinator({
      capture,
      captureStateManager: stateManager as never,
      isPaused: () => false,
      userContextBuilder: userContextBuilder as never,
      taskMiner: taskMiner as never,
    })

    coordinator.controls.requestStartCapture()

    expect(stateManager.setCaptureEnabled).toHaveBeenCalledWith(true)
    expect(capture.startCapture).toHaveBeenCalledTimes(1)
    expect(userContextBuilder.scheduleRun).toHaveBeenCalledTimes(1)
    expect(taskMiner.scheduleRun).toHaveBeenCalledTimes(1)
  })

  it('does not start capture or schedule analyzers on manual start while paused', () => {
    const capture = createCaptureMock()
    const stateManager = createCaptureStateManagerMock()
    const userContextBuilder = { scheduleRun: vi.fn() }
    const taskMiner = { scheduleRun: vi.fn() }

    const coordinator = createCaptureCoordinator({
      capture,
      captureStateManager: stateManager as never,
      isPaused: () => true,
      userContextBuilder: userContextBuilder as never,
      taskMiner: taskMiner as never,
    })

    coordinator.controls.requestStartCapture()

    expect(stateManager.setCaptureEnabled).toHaveBeenCalledWith(true)
    expect(capture.startCapture).not.toHaveBeenCalled()
    expect(userContextBuilder.scheduleRun).not.toHaveBeenCalled()
    expect(taskMiner.scheduleRun).not.toHaveBeenCalled()
  })

  it('keeps scheduling behavior on resume path', () => {
    const capture = createCaptureMock()
    const stateManager = createCaptureStateManagerMock()
    const userContextBuilder = { scheduleRun: vi.fn() }
    const taskMiner = { scheduleRun: vi.fn() }

    const coordinator = createCaptureCoordinator({
      capture,
      captureStateManager: stateManager as never,
      isPaused: () => false,
      userContextBuilder: userContextBuilder as never,
      taskMiner: taskMiner as never,
    })

    coordinator.resumeCaptureIfDesired('resume')

    expect(capture.startCapture).toHaveBeenCalledTimes(1)
    expect(userContextBuilder.scheduleRun).toHaveBeenCalledTimes(1)
    expect(taskMiner.scheduleRun).toHaveBeenCalledTimes(1)
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
    const capture = createCaptureMock()
    const stateManager = createCaptureStateManagerMock()
    const onStateChanged = vi.fn()
    const coordinator = createCaptureCoordinator({
      capture,
      captureStateManager: stateManager as never,
      isPaused: overrides?.isPaused ?? (() => false),
      userContextBuilder: { scheduleRun: vi.fn() } as never,
      taskMiner: { scheduleRun: vi.fn() } as never,
      onStateChanged,
    })
    return { capture, stateManager, onStateChanged, coordinator }
  }

  it('stops capture and records a deadline without disabling the preference', () => {
    const { capture, stateManager, onStateChanged, coordinator } = makeCoordinator()

    coordinator.controls.pauseCapture(30 * 60_000)

    expect(capture.stopCapture).toHaveBeenCalledTimes(1)
    expect(stateManager.setCaptureEnabled).not.toHaveBeenCalled()
    expect(coordinator.controls.isUserPaused()).toBe(true)
    expect(coordinator.controls.getPauseState().pausedUntilMs).not.toBeNull()
    expect(onStateChanged).toHaveBeenCalledTimes(1)
  })

  it('auto-resumes capture when the timer elapses', () => {
    const { capture, coordinator } = makeCoordinator()

    coordinator.controls.pauseCapture(30 * 60_000)
    expect(capture.startCapture).not.toHaveBeenCalled()

    vi.advanceTimersByTime(30 * 60_000)

    expect(capture.startCapture).toHaveBeenCalledTimes(1)
    expect(coordinator.controls.isUserPaused()).toBe(false)
    expect(coordinator.controls.getPauseState().pausedUntilMs).toBeNull()
  })

  it('resumes after the deadline even if the sweep was suspended during sleep', () => {
    const { capture, coordinator } = makeCoordinator()

    coordinator.controls.pauseCapture(30 * 60_000)
    expect(capture.startCapture).not.toHaveBeenCalled()

    // Simulate the Mac sleeping past the deadline: the wall clock jumps forward
    // by more than the pause duration while the sweep interval never ticks.
    vi.setSystemTime(Date.now() + 2 * 60 * 60_000)
    // The first sweep tick after wake compares the absolute deadline and resumes.
    vi.advanceTimersByTime(15_000)

    expect(capture.startCapture).toHaveBeenCalledTimes(1)
    expect(coordinator.controls.isUserPaused()).toBe(false)
    expect(coordinator.controls.getPauseState().pausedUntilMs).toBeNull()
  })

  it('resumeCapture starts capture immediately and cancels the sweep', () => {
    const { capture, coordinator } = makeCoordinator()

    coordinator.controls.pauseCapture(30 * 60_000)
    coordinator.controls.resumeCapture()

    expect(capture.startCapture).toHaveBeenCalledTimes(1)
    expect(coordinator.controls.isUserPaused()).toBe(false)

    // Timer must not fire a second start after a manual resume.
    vi.advanceTimersByTime(30 * 60_000)
    expect(capture.startCapture).toHaveBeenCalledTimes(1)
  })

  it('requestStopCapture cancels an active pause and disables the preference', () => {
    const { stateManager, coordinator } = makeCoordinator()

    coordinator.controls.pauseCapture(30 * 60_000)
    coordinator.controls.requestStopCapture()

    expect(coordinator.controls.isUserPaused()).toBe(false)
    expect(stateManager.setCaptureEnabled).toHaveBeenCalledWith(false)
  })

  it('resumeCaptureIfDesired does not override an active pause', () => {
    const { capture, coordinator } = makeCoordinator()

    coordinator.controls.pauseCapture(30 * 60_000)
    coordinator.resumeCaptureIfDesired('resume')

    expect(capture.startCapture).not.toHaveBeenCalled()
    expect(coordinator.controls.isUserPaused()).toBe(true)
  })
})
