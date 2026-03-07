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
}

export function createPipelineHarness(params: {
  outputDir: string
  frameIntervalMs?: number
  activityProducerConfig?: Partial<ActivityProducerConfig>
  activityExtractorConfig?: Partial<ActivityExtractorConfig>
  extractorTransformer?: ActivityTransformer
  extractorSink?: ActivitySink
}): PipelineHarness {
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
              cleanupActivityFiles(activity, params.outputDir)
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

        cleanupTimer = setInterval(() => {
          sweepStaleFiles(params.outputDir)
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
  }
}
