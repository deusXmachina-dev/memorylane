import type { Activity } from './activity-types'
import type { ActivityTransformer, ExtractedActivity } from './activity-extraction-types'
import type {
  ActivityVideoStitcher,
  ActivityVideoFrameInput,
  ActivityOcrService,
  ActivitySemanticService,
  ActivityEmbeddingService,
} from './activity-transformer-types'
import type { SemanticPipelinePreference } from './activity-semantic-service'
import log from './logger'

export interface DefaultActivityTransformerConfig {
  outputDir: string
  getPipelinePreference?: () => SemanticPipelinePreference
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

  async transform(activity: Activity): Promise<ExtractedActivity> {
    const frames: ActivityVideoFrameInput[] = activity.frames.map((f) => ({
      filepath: f.frame.filepath,
      timestamp: f.frame.timestamp,
    }))

    const shouldStitchVideo = this.config.getPipelinePreference?.() !== 'image'
    const outputPath = shouldStitchVideo ? `${this.config.outputDir}/${activity.id}.mp4` : undefined

    const [videoAsset, ocrText] = await Promise.all([
      shouldStitchVideo && outputPath
        ? this.stitcher.stitch({ activityId: activity.id, frames, outputPath })
        : Promise.resolve(null),
      this.extractOcrText(activity),
    ])

    const { summary, model: summaryModel } = await this.semantic.summarizeFromVideo({
      activity,
      videoPath: videoAsset?.videoPath,
    })

    const textToEmbed = summary || ocrText
    let vector: number[]
    try {
      vector = await this.embedder.embed(textToEmbed)
    } catch (error) {
      log.error(`[ActivityTransformer] Embedding failed for activity ${activity.id}:`, error)
      throw error
    }

    return {
      activityId: activity.id,
      startTimestamp: activity.startTimestamp,
      endTimestamp: activity.endTimestamp,
      appName: activity.context.appName,
      windowTitle: activity.context.windowTitle ?? '',
      tld: activity.context.tld,
      summary,
      summaryModel,
      ocrText,
      vector,
    }
  }

  private async extractOcrText(activity: Activity): Promise<string> {
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
