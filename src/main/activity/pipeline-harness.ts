import type { InteractionContext, EventWindow } from '@/shared/types'
import { SCREENSHOT_CLEANUP_CONFIG } from '@constants'
import { EventCapturer } from './event-capturer'
import { ActivityProducer } from './activity-producer'
import type { Activity, ActivityProducerConfig } from './activity-types'
import { ActivityExtractor } from './activity-extractor'
import type {
  ActivitySink,
  ActivityTransformer,
  ActivityExtractorConfig,
} from './activity-extraction-types'
import { InMemoryStream } from '@main/streams/in-memory-stream'
import { ScreenCapturer, type Frame } from '@main/recorder/screen-capturer'
import { cleanupActivityFiles, sweepStaleFiles } from './activity-cleanup'
import {
  createCaptureBlacklistCoordinator,
  type CaptureBlacklistCoordinator,
} from '@main/capture/capture-blacklist-coordinator'
import log from '@main/utils/logger'

type InteractionListener = (event: InteractionContext) => void

export interface InteractionSource {
  startInteractionMonitoring(): void
  stopInteractionMonitoring(): void
  onInteraction(listener: InteractionListener): void
  clearInteractionCallback(listener: InteractionListener): void
}

export interface IdleSource {
  onIdle(listener: (lastInputAt: number) => void): () => void
  onReturn(listener: (at: number) => void): () => void
}

export interface CaptureExclusions {
  apps: string[]
  urlPatterns: string[]
  excludePrivateBrowsing: boolean
  excludeLoginScreens: boolean
}

export interface PipelineHarness {
  frameStream: InMemoryStream<Frame>
  eventStream: InMemoryStream<EventWindow>
  activityStream: InMemoryStream<Activity>
  screenCapturer: ScreenCapturer
  eventCapturer: EventCapturer
  activityProducer: ActivityProducer
  activityExtractor?: ActivityExtractor
  start(): Promise<void>
  stop(): Promise<void>
  /** True from the moment start() is requested until stop() is requested or start fails. */
  capturing(): boolean
  /** Resolves once every queued start/stop/suppression transition has settled. */
  waitForIdle(): Promise<void>
  /**
   * Drain the producer→extractor pipeline without stopping capture: close the
   * open event window, finalize the pending activity, and wait until the
   * extractor has summarized + persisted everything queued. Used by the in-app
   * eval recorder so a session's final activity is captured before promotion.
   */
  drainActivities(): Promise<void>
  handleEvent(event: InteractionContext): void
  flushEvents(): Promise<void>
  updateExclusions: CaptureBlacklistCoordinator['updateExclusions']
  setManagedExclusions: CaptureBlacklistCoordinator['setManagedExclusions']
  setFrameCaptureSuppressed(suppressed: boolean): Promise<void>
  updateActivityWindowConfig(input: {
    minActivityDurationMs: number
    maxActivityDurationMs: number
  }): void
  /**
   * Toggle screenshot/video retention at runtime. While true, processed
   * activities' frames/videos are NOT deleted and the periodic stale sweep is
   * skipped, so frames survive (e.g. for the in-app eval recorder). The
   * screenshots dir grows until set back to false (then call `sweepNow`).
   */
  setRetainScreenshots(value: boolean): void
  /** Run the stale-file sweep immediately (e.g. to reclaim after retention off). */
  sweepNow(): void
  dispose(): void
}

export function createPipelineHarness(params: {
  outputDir: string
  frameIntervalMs?: number
  activityProducerConfig?: Partial<ActivityProducerConfig>
  activityExtractorConfig?: Partial<ActivityExtractorConfig>
  extractorTransformer?: ActivityTransformer
  extractorSink?: ActivitySink
  // Debug-only: when true, processed activities' frames/videos are NOT deleted
  // and the periodic stale-file sweep is disabled, so screenshots survive for
  // inspection. Lets the screenshots dir grow unbounded — dev use only.
  retainScreenshots?: boolean
  interactions?: InteractionSource
  idle?: IdleSource
  exclusions?: Partial<CaptureExclusions>
  onPrivacyBlockingChanged?: (blocked: boolean) => void
  // Sees only events that passed the blacklist.
  onAcceptedEvent?: InteractionListener
}): PipelineHarness {
  // Mutable so the eval recorder can hold retention open for a recording and
  // release it afterwards, without a restart. Read live at the cleanup callsites.
  let retainScreenshots = params.retainScreenshots ?? false
  const frameStream = new InMemoryStream<Frame>()
  const eventStream = new InMemoryStream<EventWindow>()
  const activityStream = new InMemoryStream<Activity>()

  const screenCapturer = new ScreenCapturer({
    intervalMs: params.frameIntervalMs,
    outputDir: params.outputDir,
    stream: frameStream,
  })
  const eventCapturer = new EventCapturer(eventStream)
  const activityProducer = new ActivityProducer({
    frameStream,
    eventStream,
    activityStream,
    config: params.activityProducerConfig,
  })

  if (
    (params.extractorTransformer && !params.extractorSink) ||
    (!params.extractorTransformer && params.extractorSink)
  ) {
    throw new Error('extractorTransformer and extractorSink must be provided together')
  }

  const activityExtractor =
    params.extractorTransformer && params.extractorSink
      ? new ActivityExtractor({
          activityStream,
          transformer: params.extractorTransformer,
          sink: params.extractorSink,
          config: {
            ...params.activityExtractorConfig,
            onTaskComplete: (activity) => {
              if (!retainScreenshots) {
                cleanupActivityFiles(activity, params.outputDir)
              }
            },
          },
        })
      : undefined

  let cleanupTimer: ReturnType<typeof setInterval> | null = null
  let running = false
  let desired = false
  let startRequests = 0
  let frameCaptureSuppressed = false
  let queue: Promise<void> = Promise.resolve()
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task)
    queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  const handleEvent = (event: InteractionContext): void => {
    if (event.type === 'app_change' && event.displayId !== undefined) {
      screenCapturer.setDisplayId(event.displayId)
    }
    eventCapturer.handleEvent(event)
  }

  const applyFrameCaptureSuppressed = async (suppressed: boolean): Promise<void> => {
    if (frameCaptureSuppressed === suppressed) return
    frameCaptureSuppressed = suppressed
    if (!running) return
    if (suppressed) {
      if (screenCapturer.capturing) await screenCapturer.stop()
    } else if (!screenCapturer.capturing) {
      await screenCapturer.start()
    }
  }
  const setFrameCaptureSuppressed = (suppressed: boolean): Promise<void> =>
    serial(() => applyFrameCaptureSuppressed(suppressed))

  const teardown = async (): Promise<void> => {
    try {
      params.interactions?.stopInteractionMonitoring()
    } catch (error) {
      log.error('[PipelineHarness] Failed to stop interaction monitor:', error)
    }
    if (cleanupTimer) {
      clearInterval(cleanupTimer)
      cleanupTimer = null
    }
    const captureStopped = screenCapturer.stop()
    try {
      await eventCapturer.flushAndWait()
      await activityProducer.stop()
      if (activityExtractor) {
        await activityExtractor.stop()
      }
      eventCapturer.destroy()
    } finally {
      await captureStopped
    }
  }

  const blacklist = createCaptureBlacklistCoordinator({
    initialExcludedApps: params.exclusions?.apps,
    initialExcludedUrlPatterns: params.exclusions?.urlPatterns,
    initialExcludePrivateBrowsing: params.exclusions?.excludePrivateBrowsing,
    initialExcludeLoginScreens: params.exclusions?.excludeLoginScreens,
    onPrivacyBlockingChanged: params.onPrivacyBlockingChanged,
    forwardInteraction: (event) => {
      params.onAcceptedEvent?.(event)
      handleEvent(event)
    },
    flushEvents: (boundaryTimestamp) => eventCapturer.flush(boundaryTimestamp),
    setScreenshotsSuppressed: (suppressed) => {
      void setFrameCaptureSuppressed(suppressed).catch((error) => {
        log.error('[PipelineHarness] Failed to toggle frame capture:', error)
      })
    },
  })

  const onInteraction: InteractionListener = (event) => blacklist.handleInteraction(event)
  params.interactions?.onInteraction(onInteraction)
  const idleUnsubscribers = params.idle
    ? [
        params.idle.onIdle((lastInputAt) => eventCapturer.closeIdle(lastInputAt)),
        params.idle.onReturn((at) => {
          if (running) eventCapturer.openReturn(at)
        }),
      ]
    : []

  return {
    frameStream,
    eventStream,
    activityStream,
    screenCapturer,
    eventCapturer,
    activityProducer,
    activityExtractor,
    start: () => {
      desired = true
      const request = ++startRequests
      return serial(async () => {
        if (running) return
        running = true
        try {
          await activityProducer.start()
          if (activityExtractor) {
            await activityExtractor.start()
          }
          if (!frameCaptureSuppressed) {
            await screenCapturer.start()
          }

          if (retainScreenshots) {
            log.warn(
              '[PipelineHarness] retainScreenshots enabled — activity frames/videos are kept and the ' +
                'stale-file sweep is disabled. The screenshots dir will grow unbounded (debug only).',
            )
          }
          // Timer always runs; the sweep itself is skipped while retention is on,
          // so toggling `setRetainScreenshots` at runtime takes effect immediately.
          cleanupTimer = setInterval(() => {
            if (!retainScreenshots) sweepStaleFiles(params.outputDir)
          }, SCREENSHOT_CLEANUP_CONFIG.CLEANUP_INTERVAL_MS)
          params.interactions?.startInteractionMonitoring()
          log.info('[PipelineHarness] Pipeline started')
        } catch (error) {
          running = false
          if (request === startRequests) desired = false
          log.error('[PipelineHarness] Failed to start pipeline:', error)
          try {
            await teardown()
          } catch (teardownError) {
            log.error('[PipelineHarness] Failed to tear down after start error:', teardownError)
          }
          throw error
        }
      })
    },
    stop: () => {
      desired = false
      return serial(async () => {
        if (!running) return
        running = false
        await teardown()
        log.info('[PipelineHarness] Pipeline stopped')
      })
    },
    capturing: () => desired,
    waitForIdle: () => queue,
    async drainActivities() {
      if (!running) return
      await eventCapturer.flushAndWait()
      await activityProducer.flush()
      if (activityExtractor) {
        await activityExtractor.waitForIdle()
      }
    },
    handleEvent,
    async flushEvents() {
      eventCapturer.flush()
      await eventCapturer.waitForIdle()
    },
    updateExclusions: (exclusions) => blacklist.updateExclusions(exclusions),
    setManagedExclusions: (managed) => blacklist.setManagedExclusions(managed),
    setFrameCaptureSuppressed,
    updateActivityWindowConfig(input) {
      activityProducer.updateActivityWindowConfig({
        ...input,
        frameBufferRetentionMs: Math.max(input.maxActivityDurationMs * 2, 1),
      })
    },
    setRetainScreenshots(value: boolean) {
      retainScreenshots = value
      log.info(`[PipelineHarness] retainScreenshots set to ${value}`)
    },
    sweepNow() {
      sweepStaleFiles(params.outputDir)
    },
    dispose() {
      params.interactions?.clearInteractionCallback(onInteraction)
      for (const unsubscribe of idleUnsubscribers) unsubscribe()
    },
  }
}
