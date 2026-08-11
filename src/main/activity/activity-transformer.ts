import type { Activity } from './activity-types'
import type { ActivityTransformer, ExtractedActivity } from './activity-extraction-types'
import type {
  ActivityVideoStitcher,
  ActivityVideoFrameInput,
  ActivityOcrService,
  ActivitySemanticService,
  ActivityEmbeddingService,
} from './activity-transformer-types'
import type { SemanticPipelinePreference } from '@main/semantic/activity-semantic-service'
import type { SummaryModeTrackerLike } from '@main/semantic/types'
import { isPassiveView } from './passive-view'
import { ACTIVITY_CONFIG } from '@constants'
import log from '@main/utils/logger'

export interface DefaultActivityTransformerConfig {
  outputDir: string
  getPipelinePreference?: () => SemanticPipelinePreference
  summaryModeTracker?: SummaryModeTrackerLike
}

const OCR_FRAME_POSITION_FROM_END = 5

// summaryModel value stamped on activities summarized by the no-LLM heuristic
// path, so they're distinguishable from LLM output ('') and real models.
const HEURISTIC_VIEWED_MODEL = 'heuristic:viewed'

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

    const durationMs = activity.endTimestamp - activity.startTimestamp
    const useHeuristic =
      isPassiveView(activity) && durationMs < ACTIVITY_CONFIG.HEURISTIC_SUMMARY_MAX_DURATION_MS

    const shouldStitchVideo = !useHeuristic && this.config.getPipelinePreference?.() !== 'image'
    const outputPath = shouldStitchVideo ? `${this.config.outputDir}/${activity.id}.mp4` : undefined

    const [videoAsset, ocrText] = await Promise.all([
      shouldStitchVideo && outputPath
        ? this.stitcher.stitch({ activityId: activity.id, frames, outputPath })
        : Promise.resolve(null),
      this.extractOcrText(activity),
    ])

    // A short passive view (no clicks/keystrokes/scrolls — only app focus, or
    // nothing) carries little narrative for an LLM to summarize, so skip the
    // expensive inference and label it from its on-screen context. We embed its
    // OCR'd contents rather than the "Viewed X" label so it stays findable by
    // what was actually on screen.
    const { summary, summaryModel, textToEmbed } = useHeuristic
      ? this.buildPassiveSummary(activity, ocrText)
      : await this.buildSemanticSummary(activity, videoAsset?.videoPath, ocrText)

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

  private async buildSemanticSummary(
    activity: Activity,
    videoPath: string | undefined,
    ocrText: string,
  ): Promise<{ summary: string; summaryModel: string; textToEmbed: string }> {
    const { summary, model } = await this.semantic.summarizeFromVideo({ activity, videoPath })
    return { summary, summaryModel: model, textToEmbed: summary || ocrText }
  }

  private buildPassiveSummary(
    activity: Activity,
    ocrText: string,
  ): { summary: string; summaryModel: string; textToEmbed: string } {
    const { windowTitle, tld, appName } = activity.context
    const label = windowTitle?.trim() || tld || appName
    this.config.summaryModeTracker?.record({
      mode: 'passive',
      reason: 'passive',
      failureDetail: '',
    })
    return {
      summary: `Viewed ${label}`,
      summaryModel: HEURISTIC_VIEWED_MODEL,
      textToEmbed: ocrText || `Viewed ${label}`,
    }
  }
}
