import * as path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtractedActivity } from './activity-extraction-types'
import type { Activity } from './activity-types'
import type { StreamSubscription } from './streams/stream'
import { createPipelineHarness } from './pipeline-harness'
import type {
  CaptureBackendConfig,
  CaptureBackendCommand,
  CapturedFrame,
} from './recorder/native-screenshot'

vi.mock('./logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

const { mockBackendState } = vi.hoisted(() => {
  const mockBackendState = {
    onFrame: null as ((frame: CapturedFrame) => void) | null,
    outputDir: '',
    intervalMs: 1000,
    frameTimer: null as ReturnType<typeof setInterval> | null,
    lastDisplayId: undefined as number | null | undefined,
    lastSentCommand: undefined as CaptureBackendCommand | undefined,
    startCalls: 0,
    stopCalls: 0,
  }
  return { mockBackendState }
})

vi.mock('./recorder/native-screenshot', () => ({
  createScreenCaptureBackend: () => ({
    start: vi.fn(async (config: CaptureBackendConfig) => {
      mockBackendState.startCalls++
      mockBackendState.onFrame = config.onFrame
      mockBackendState.outputDir = config.outputDir
      mockBackendState.intervalMs = config.intervalMs ?? 1000
      // Simulate autonomous frame emission
      mockBackendState.frameTimer = setInterval(() => {
        if (mockBackendState.onFrame) {
          const filepath = path.join(mockBackendState.outputDir, `frame-${Date.now()}.jpg`)
          mockBackendState.onFrame({
            filepath,
            timestamp: Date.now(),
            width: 1280,
            height: 720,
            displayId: (mockBackendState.lastDisplayId as number) ?? 1,
          })
        }
      }, mockBackendState.intervalMs)
    }),
    stop: vi.fn(async () => {
      mockBackendState.stopCalls++
      if (mockBackendState.frameTimer) {
        clearInterval(mockBackendState.frameTimer)
        mockBackendState.frameTimer = null
      }
      mockBackendState.onFrame = null
    }),
    send: vi.fn((command: CaptureBackendCommand) => {
      mockBackendState.lastSentCommand = command
      if (command.displayId !== undefined) {
        mockBackendState.lastDisplayId = command.displayId
      }
    }),
  }),
}))

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 2_000,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return
    await sleep(10)
  }
  throw new Error(message)
}

describe('pipeline harness', () => {
  const subscriptions: StreamSubscription[] = []

  afterEach(() => {
    mockBackendState.onFrame = null
    mockBackendState.lastDisplayId = undefined
    mockBackendState.lastSentCommand = undefined
    mockBackendState.startCalls = 0
    mockBackendState.stopCalls = 0
    if (mockBackendState.frameTimer) {
      clearInterval(mockBackendState.frameTimer)
      mockBackendState.frameTimer = null
    }
    for (const sub of subscriptions.splice(0)) {
      sub.unsubscribe()
    }
  })

  it('wires screen + event + activity producer with in-memory streams', async () => {
    const harness = createPipelineHarness({
      outputDir: path.join(process.cwd(), '.tmp-harness'),
      frameIntervalMs: 10,
      activityProducerConfig: {
        frameJoinGraceMs: 0,
        maxFrameWaitMs: 0,
        minActivityDurationMs: 0,
        eventConsumerId: 'harness:event',
        frameConsumerId: 'harness:frame',
      },
    })
    expect(harness.activityExtractor).toBeUndefined()

    const activities: Activity[] = []
    subscriptions.push(
      harness.activityStream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => activities.push(record.payload),
      }),
    )

    await harness.start()

    const startTs = Date.now()
    harness.handleEvent({
      type: 'app_change',
      timestamp: startTs,
      activeWindow: {
        title: 'Harness Window',
        processName: 'Code',
        bundleId: 'com.microsoft.VSCode',
      },
    })

    await sleep(60)
    harness.handleEvent({
      type: 'keyboard',
      timestamp: Date.now(),
      keyCount: 3,
      durationMs: 60,
    })
    harness.eventCapturer.flush()

    await waitFor(() => activities.length >= 1, 'Expected activity emitted from harness wiring')
    expect(activities[0].frames.length).toBeGreaterThan(0)
    expect(activities[0].context.appName).toBe('Code')
    expect(harness.activityProducer.getStats().emittedActivities).toBeGreaterThanOrEqual(1)

    await harness.stop()
  })

  it('retargets captures when app_change reports a different display', async () => {
    const harness = createPipelineHarness({
      outputDir: path.join(process.cwd(), '.tmp-harness-display-retarget'),
      frameIntervalMs: 20,
      activityProducerConfig: {
        frameJoinGraceMs: 0,
        maxFrameWaitMs: 0,
        minActivityDurationMs: 0,
        eventConsumerId: 'harness:event:display-retarget',
        frameConsumerId: 'harness:frame:display-retarget',
      },
    })

    await harness.start()
    await sleep(40)

    harness.handleEvent({
      type: 'app_change',
      timestamp: Date.now(),
      displayId: 2,
      activeWindow: {
        title: 'Display 2 Window',
        processName: 'Code',
        bundleId: 'com.microsoft.VSCode',
      },
    })

    await waitFor(
      () => mockBackendState.lastSentCommand?.displayId === 2,
      'Expected backend.send to receive displayId=2 after app_change',
    )

    await harness.stop()
  })

  it('optionally wires extractor and routes activities through transformer + sink', async () => {
    const transformedActivityIds: string[] = []
    const persistedActivityIds: string[] = []

    const harness = createPipelineHarness({
      outputDir: path.join(process.cwd(), '.tmp-harness-extractor'),
      frameIntervalMs: 10,
      activityProducerConfig: {
        frameJoinGraceMs: 0,
        maxFrameWaitMs: 0,
        minActivityDurationMs: 0,
        eventConsumerId: 'harness:event:extractor',
        frameConsumerId: 'harness:frame:extractor',
      },
      activityExtractorConfig: {
        consumerId: 'harness:activity-extractor',
        maxConcurrent: 1,
        maxRetries: 0,
        retryBackoffMs: 0,
      },
      extractorTransformer: {
        transform: async (activity): Promise<ExtractedActivity> => {
          transformedActivityIds.push(activity.id)
          return {
            activityId: activity.id,
            startTimestamp: activity.startTimestamp,
            endTimestamp: activity.endTimestamp,
            appName: activity.context.appName,
            windowTitle: activity.context.windowTitle ?? '',
            tld: activity.context.tld,
            summary: `summary:${activity.id}`,
            ocrText: `ocr:${activity.id}`,
            vector: [0.1, 0.2, 0.3],
          }
        },
      },
      extractorSink: {
        persist: async ({ activity, extracted }) => {
          expect(extracted.activityId).toBe(activity.id)
          persistedActivityIds.push(activity.id)
        },
      },
    })

    expect(harness.activityExtractor).toBeDefined()
    const extractor = harness.activityExtractor!

    await harness.start()

    const startTs = Date.now()
    harness.handleEvent({
      type: 'app_change',
      timestamp: startTs,
      activeWindow: {
        title: 'Harness Extractor Window',
        processName: 'Code',
        bundleId: 'com.microsoft.VSCode',
      },
    })

    await sleep(60)
    harness.handleEvent({
      type: 'keyboard',
      timestamp: Date.now(),
      keyCount: 2,
      durationMs: 60,
    })
    harness.eventCapturer.flush()

    await waitFor(
      () => persistedActivityIds.length >= 1,
      'Expected extractor sink to persist at least one activity',
    )
    await waitFor(
      async () => (await harness.activityStream.getAck('harness:activity-extractor')) !== null,
      'Expected extractor to ack activity stream progress',
    )

    expect(transformedActivityIds).toHaveLength(1)
    expect(persistedActivityIds).toEqual(transformedActivityIds)
    expect(extractor.getStats().succeeded).toBe(1)

    await harness.stop()
  })

  it('suppresses and resumes frame capture while running', async () => {
    const harness = createPipelineHarness({
      outputDir: path.join(process.cwd(), '.tmp-harness-suppression'),
      frameIntervalMs: 10,
    })

    await harness.start()
    await waitFor(
      () => mockBackendState.startCalls >= 1,
      'Expected backend.start to be called on harness start',
    )
    expect(mockBackendState.frameTimer).not.toBeNull()

    await harness.setFrameCaptureSuppressed(true)
    await waitFor(
      () => mockBackendState.stopCalls >= 1,
      'Expected backend.stop to be called when suppression is enabled',
    )
    expect(mockBackendState.frameTimer).toBeNull()

    await harness.setFrameCaptureSuppressed(false)
    await waitFor(
      () => mockBackendState.startCalls >= 2,
      'Expected backend.start to be called again when suppression is disabled',
    )
    expect(mockBackendState.frameTimer).not.toBeNull()

    await harness.stop()
  })

  it('does not churn start/stop calls when suppression state is set repeatedly', async () => {
    const harness = createPipelineHarness({
      outputDir: path.join(process.cwd(), '.tmp-harness-suppression-idempotent'),
      frameIntervalMs: 10,
    })

    await harness.start()
    await waitFor(() => mockBackendState.startCalls >= 1, 'Expected initial backend start')

    await harness.setFrameCaptureSuppressed(true)
    await waitFor(() => mockBackendState.stopCalls >= 1, 'Expected stop after first suppression')
    await harness.setFrameCaptureSuppressed(true)
    expect(mockBackendState.stopCalls).toBe(1)

    await harness.setFrameCaptureSuppressed(false)
    await waitFor(() => mockBackendState.startCalls >= 2, 'Expected restart after unsuppress')
    await harness.setFrameCaptureSuppressed(false)
    expect(mockBackendState.startCalls).toBe(2)

    await harness.stop()
  })

  it('respects suppression set before start', async () => {
    const harness = createPipelineHarness({
      outputDir: path.join(process.cwd(), '.tmp-harness-suppression-prestart'),
      frameIntervalMs: 10,
    })

    await harness.setFrameCaptureSuppressed(true)
    await harness.start()
    await sleep(50)

    expect(mockBackendState.startCalls).toBe(0)
    expect(mockBackendState.frameTimer).toBeNull()

    await harness.setFrameCaptureSuppressed(false)
    await waitFor(() => mockBackendState.startCalls >= 1, 'Expected start after unsuppress')
    expect(mockBackendState.frameTimer).not.toBeNull()

    await harness.stop()
  })
})
