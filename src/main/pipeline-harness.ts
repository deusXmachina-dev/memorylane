import type { InteractionContext, EventWindow } from '../shared/types'
import { SCREENSHOT_CLEANUP_CONFIG } from '../shared/constants'
import { EventCapturer } from './event-capturer'
import { ActivityProducer } from './activity-producer'
import type { Activity, ActivityProducerConfig } from './activity-types'
import { ActivityExtractor } from './activity-extractor'
import type {
  ActivitySink,
  ActivityTransformer,
  ActivityExtractorConfig,
} from './activity-extraction-types'
import { InMemoryStream } from './streams/in-memory-stream'
import { ScreenCapturer, type Frame } from './recorder/screen-capturer'
import { cleanupActivityFiles, sweepStaleFiles } from './activity-cleanup'
import log from './logger'

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
  handleEvent(event: InteractionContext): void
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
  let frameCaptureSuppressed = false

  return {
    frameStream,
    eventStream,
    activityStream,
    screenCapturer,
    eventCapturer,
    activityProducer,
    activityExtractor,
    async start() {
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
      } catch (error) {
        running = false
        throw error
      }
    },
    async stop() {
      if (!running) return
      running = false
      if (cleanupTimer) {
        clearInterval(cleanupTimer)
        cleanupTimer = null
      }
      await screenCapturer.stop()
      await eventCapturer.flushAndWait()
      await activityProducer.stop()
      if (activityExtractor) {
        await activityExtractor.stop()
      }
      eventCapturer.destroy()
    },
    handleEvent(event: InteractionContext) {
      if (event.type === 'app_change' && event.displayId !== undefined) {
        screenCapturer.setDisplayId(event.displayId)
      }
      eventCapturer.handleEvent(event)
    },
    async setFrameCaptureSuppressed(suppressed: boolean) {
      if (frameCaptureSuppressed === suppressed) return
      frameCaptureSuppressed = suppressed

      if (!running) return

      if (suppressed) {
        if (screenCapturer.capturing) {
          await screenCapturer.stop()
        }
        return
      }

      if (!screenCapturer.capturing) {
        await screenCapturer.start()
      }
    },
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
  }
}
