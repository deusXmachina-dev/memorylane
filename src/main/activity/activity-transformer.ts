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
import { getLoginScreenMatch } from '@main/capture/capture-login-gate'
import log from '@main/utils/logger'

export interface DefaultActivityTransformerConfig {
  outputDir: string
  getPipelinePreference?: () => SemanticPipelinePreference
  getExcludeLoginScreens?: () => boolean
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

    const shouldStitchVideo = this.config.getPipelinePreference?.() !== 'image'
    const outputPath = shouldStitchVideo ? `${this.config.outputDir}/${activity.id}.mp4` : undefined

    const passiveView = this.isPassiveView(activity)

    const [videoAsset, ocrText] = await Promise.all([
      shouldStitchVideo && outputPath
        ? this.stitcher.stitch({ activityId: activity.id, frames, outputPath })
        : Promise.resolve(null),
      this.extractOcrText(activity),
    ])

    // A passive view (no clicks/keystrokes/scrolls — only app focus, or nothing)
    // carries little narrative for an LLM to summarize, so skip the expensive
    // inference and label it from its on-screen context. We embed its OCR'd
    // contents rather than the "Viewed X" label so it stays findable by what was
    // actually on screen.
    const { summary, summaryModel, textToEmbed } = passiveView
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
    if (this.config.getExcludeLoginScreens?.() !== false) {
      const loginScreenMatch = getLoginScreenMatch({
        processName: activity.context.appName,
        bundleId: activity.context.bundleId,
        title: activity.context.windowTitle,
        url: activity.context.url,
      })
      if (loginScreenMatch !== null) {
        log.debug(
          `[ActivityTransformer] Skipping OCR for activity ${activity.id} (login_screen=${loginScreenMatch})`,
        )
        return ''
      }
    }
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
    return {
      summary: `Viewed ${label}`,
      summaryModel: HEURISTIC_VIEWED_MODEL,
      textToEmbed: ocrText || `Viewed ${label}`,
    }
  }

  /**
   * A view with no clicks, keystrokes, or scrolls — only app focus, presence
   * heartbeats, or nothing. Defined as the absence of active-engagement events
   * so synthetic 'presence' keep-alives don't push a read onto the LLM path.
   */
  private isPassiveView(activity: Activity): boolean {
    return !activity.interactions.some(
      (interaction) =>
        interaction.type === 'click' ||
        interaction.type === 'keyboard' ||
        interaction.type === 'scroll',
    )
  }
}
