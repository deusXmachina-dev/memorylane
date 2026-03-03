import type { V2Activity } from './activity-types'
import type { ActivityTransformer, V2ExtractedActivity } from './activity-extraction-types'
import type {
  ActivityVideoStitcher,
  ActivityVideoFrameInput,
  ActivityOcrService,
  ActivitySemanticService,
  ActivityEmbeddingService,
} from './activity-transformer-types'
import log from '../logger'

export interface DefaultActivityTransformerConfig {
  outputDir: string
}

const OCR_FRAME_POSITION_FROM_END = 5

export class DefaultActivityTransformer implements ActivityTransformer {
  constructor(
    private stitcher: ActivityVideoStitcher,
    private ocr: ActivityOcrService,
    private semantic: ActivitySemanticService,
    private embedder: ActivityEmbeddingService,
    private config: DefaultActivityTransformerConfig,
  ) {}

  async transform(activity: V2Activity): Promise<V2ExtractedActivity> {
    const frames: ActivityVideoFrameInput[] = activity.frames.map((f) => ({
      filepath: f.frame.filepath,
      timestamp: f.frame.timestamp,
    }))

    const outputPath = `${this.config.outputDir}/${activity.id}.mp4`

    const [videoAsset, ocrText] = await Promise.all([
      this.stitcher.stitch({ activityId: activity.id, frames, outputPath }),
      this.extractOcrText(activity),
    ])

    const summary = await this.semantic.summarizeFromVideo({
      activity,
      videoPath: videoAsset.videoPath,
      ocrText,
    })

    const textToEmbed = summary || ocrText
    const vector = await this.embedder.embed(textToEmbed)

    return {
      activityId: activity.id,
      startTimestamp: activity.startTimestamp,
      endTimestamp: activity.endTimestamp,
      appName: activity.context.appName,
      windowTitle: activity.context.windowTitle ?? '',
      tld: activity.context.tld,
      summary,
      ocrText,
      vector,
    }
  }

  private async extractOcrText(activity: V2Activity): Promise<string> {
    if (activity.frames.length === 0) return ''
    const ocrFrame =
      activity.frames.length >= OCR_FRAME_POSITION_FROM_END
        ? activity.frames[activity.frames.length - OCR_FRAME_POSITION_FROM_END]
        : activity.frames[0]

    try {
      return await this.ocr.extractText(ocrFrame.frame.filepath)
    } catch (error) {
      log.warn(`[ActivityTransformer] OCR failed for activity ${activity.id}:`, error)
      return ''
    }
  }
}
