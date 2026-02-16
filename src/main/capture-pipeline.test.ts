import { describe, it, expect, vi } from 'vitest'
import { CaptureSession, InteractionContext, Screenshot, SessionEndReason } from '../shared/types'
import {
  wireCapturePipeline,
  CapturePipelineHooks,
  InteractionMonitorLike,
  SessionRecorderLike,
  SessionProcessorLike,
  ScreenshotRecorderLike,
  ScreenshotProcessorLike,
} from './capture-pipeline'

function createScreenshot(id: string, timestamp: number): Screenshot {
  return {
    id,
    filepath: `/tmp/${id}.png`,
    timestamp,
    display: { id: 1, width: 1920, height: 1080 },
    trigger: { type: 'manual' },
  }
}

function createSession(endReason: SessionEndReason): CaptureSession {
  const startTimestamp = 1_700_000_000_000
  return {
    sessionId: `session-${endReason}`,
    appName: 'Code',
    startTimestamp,
    endTimestamp: startTimestamp + 10_000,
    screenshots: [
      createScreenshot(`start-${endReason}`, startTimestamp),
      createScreenshot(`end-${endReason}`, startTimestamp + 10_000),
    ],
    interactionEvents: [],
    endReason,
  }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

describe('wireCapturePipeline', () => {
  it('uses session mode and processes all end reasons exactly once', async () => {
    let sessionCallback: ((session: CaptureSession) => void) | null = null
    const recorder: SessionRecorderLike = {
      onSessionComplete: vi.fn((callback) => {
        sessionCallback = callback
      }),
    }
    const processSession = vi
      .fn<(session: CaptureSession) => Promise<void>>()
      .mockResolvedValue(undefined)
    const processor: SessionProcessorLike = { processSession }
    const interactionMonitor: InteractionMonitorLike = {
      onInteraction: vi.fn(),
    }
    const hooks: CapturePipelineHooks = {
      onProcessed: vi.fn(),
      onProcessingError: vi.fn(),
    }

    const mode = wireCapturePipeline({
      recorder,
      processor,
      interactionMonitor,
      hooks,
    })

    expect(mode).toBe('session')
    expect(recorder.onSessionComplete).toHaveBeenCalledTimes(1)
    expect(interactionMonitor.onInteraction).not.toHaveBeenCalled()
    expect(sessionCallback).not.toBeNull()
    if (sessionCallback === null) {
      return
    }

    const endReasons: SessionEndReason[] = ['app_switch', 'max_duration', 'stop']
    for (const endReason of endReasons) {
      sessionCallback(createSession(endReason))
    }
    await flushMicrotasks()

    expect(processSession).toHaveBeenCalledTimes(3)
    expect(processSession.mock.calls.map(([session]) => session.endReason)).toEqual(endReasons)
    expect(hooks.onProcessed).toHaveBeenCalledTimes(3)
    expect(hooks.onProcessingError).not.toHaveBeenCalled()
  })

  it('falls back to screenshot mode and forwards interaction events', async () => {
    let screenshotCallback: ((screenshot: Screenshot) => void) | null = null
    let interactionCallback: ((event: InteractionContext) => void) | null = null

    const recorder: ScreenshotRecorderLike = {
      onScreenshot: vi.fn((callback) => {
        screenshotCallback = callback
      }),
    }
    const processScreenshot = vi.fn().mockResolvedValue(undefined)
    const addInteractionEvent = vi.fn()
    const processor: ScreenshotProcessorLike = {
      processScreenshot,
      addInteractionEvent,
    }
    const interactionMonitor: InteractionMonitorLike = {
      onInteraction: vi.fn((callback) => {
        interactionCallback = callback
      }),
    }
    const hooks: CapturePipelineHooks = {
      onProcessed: vi.fn(),
      onProcessingError: vi.fn(),
    }

    const mode = wireCapturePipeline({
      recorder,
      processor,
      interactionMonitor,
      hooks,
    })

    expect(mode).toBe('screenshot')
    expect(recorder.onScreenshot).toHaveBeenCalledTimes(1)
    expect(interactionMonitor.onInteraction).toHaveBeenCalledTimes(1)
    expect(screenshotCallback).not.toBeNull()
    expect(interactionCallback).not.toBeNull()
    if (screenshotCallback === null || interactionCallback === null) {
      return
    }

    interactionCallback({
      type: 'click',
      timestamp: Date.now(),
      clickPosition: { x: 1, y: 2 },
    })
    expect(addInteractionEvent).toHaveBeenCalledTimes(1)

    screenshotCallback(createScreenshot('legacy-shot', Date.now()))
    await flushMicrotasks()

    expect(processScreenshot).toHaveBeenCalledTimes(1)
    expect(hooks.onProcessed).toHaveBeenCalledTimes(1)
    expect(hooks.onProcessingError).not.toHaveBeenCalled()
  })

  it('reports processor failures through hooks', async () => {
    let sessionCallback: ((session: CaptureSession) => void) | null = null
    const recorder: SessionRecorderLike = {
      onSessionComplete: vi.fn((callback) => {
        sessionCallback = callback
      }),
    }
    const failure = new Error('session processing failed')
    const processor: SessionProcessorLike = {
      processSession: vi
        .fn<(session: CaptureSession) => Promise<void>>()
        .mockRejectedValue(failure),
    }
    const interactionMonitor: InteractionMonitorLike = {
      onInteraction: vi.fn(),
    }
    const hooks: CapturePipelineHooks = {
      onProcessed: vi.fn(),
      onProcessingError: vi.fn(),
    }

    wireCapturePipeline({
      recorder,
      processor,
      interactionMonitor,
      hooks,
    })

    expect(sessionCallback).not.toBeNull()
    if (sessionCallback === null) {
      return
    }

    const session = createSession('stop')
    sessionCallback(session)
    await flushMicrotasks()

    expect(hooks.onProcessed).not.toHaveBeenCalled()
    expect(hooks.onProcessingError).toHaveBeenCalledWith(session.sessionId, failure)
  })

  it('throws when neither session nor screenshot contracts are available', () => {
    const interactionMonitor: InteractionMonitorLike = {
      onInteraction: vi.fn(),
    }
    const hooks: CapturePipelineHooks = {
      onProcessed: vi.fn(),
      onProcessingError: vi.fn(),
    }

    expect(() =>
      wireCapturePipeline({
        recorder: {},
        processor: {},
        interactionMonitor,
        hooks,
      }),
    ).toThrow('Unable to wire capture pipeline')
  })
})
