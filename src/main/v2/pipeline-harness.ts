import type { InteractionContext, EventWindow } from '../../shared/types'
import { SCREENSHOT_CLEANUP_CONFIG } from '../../shared/constants'
import { EventCapturer } from './event-capturer'
import { ActivityProducer } from './activity-producer'
import type { V2Activity, V2ActivityProducerConfig } from './activity-types'
import { ActivityExtractor } from './activity-extractor'
import type {
  ActivitySink,
  ActivityTransformer,
  V2ActivityExtractorConfig,
} from './activity-extraction-types'
import { InMemoryStream } from './streams/in-memory-stream'
import { ScreenCapturer, type Frame } from './recorder/screen-capturer'
import { cleanupActivityFiles, sweepStaleFiles } from './activity-cleanup'

export interface V2PipelineHarness {
  frameStream: InMemoryStream<Frame>
  eventStream: InMemoryStream<EventWindow>
  activityStream: InMemoryStream<V2Activity>
  screenCapturer: ScreenCapturer
  eventCapturer: EventCapturer
  activityProducer: ActivityProducer
  activityExtractor?: ActivityExtractor
  start(): Promise<void>
  stop(): Promise<void>
  handleEvent(event: InteractionContext): void
}

export function createV2PipelineHarness(params: {
  outputDir: string
  frameIntervalMs?: number
  displayId?: number
  activityProducerConfig?: Partial<V2ActivityProducerConfig>
  activityExtractorConfig?: Partial<V2ActivityExtractorConfig>
  extractorTransformer?: ActivityTransformer
  extractorSink?: ActivitySink
}): V2PipelineHarness {
  const frameStream = new InMemoryStream<Frame>()
  const eventStream = new InMemoryStream<EventWindow>()
  const activityStream = new InMemoryStream<V2Activity>()

  const screenCapturer = new ScreenCapturer({
    intervalMs: params.frameIntervalMs,
    outputDir: params.outputDir,
    displayId: params.displayId,
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

  return {
    frameStream,
    eventStream,
    activityStream,
    screenCapturer,
    eventCapturer,
    activityProducer,
    activityExtractor,
    async start() {
      await activityProducer.start()
      if (activityExtractor) {
        await activityExtractor.start()
      }
      screenCapturer.start()

      cleanupTimer = setInterval(() => {
        sweepStaleFiles(params.outputDir)
      }, SCREENSHOT_CLEANUP_CONFIG.CLEANUP_INTERVAL_MS)
    },
    async stop() {
      if (cleanupTimer) {
        clearInterval(cleanupTimer)
        cleanupTimer = null
      }
      screenCapturer.stop()
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
  }
}
