import * as fs from 'fs'
import { extractText } from './ocr'
import { EmbeddingService } from './embedding'
import { StorageService } from './storage'
import { Activity } from '../../shared/types'
import { SemanticClassifierService } from './semantic-classifier'
import { buildChronologicalTimeline } from './activity-timeline'
import { ACTIVITY_CONFIG, OCR_CONFIG } from '@constants'
import { buildActivityVideo } from './video'
import log from '../logger'

export class ActivityProcessor {
  private embeddingService: EmbeddingService
  private storageService: StorageService
  private classifierService: SemanticClassifierService | null = null

  constructor(
    embeddingService: EmbeddingService,
    storageService: StorageService,
    classifierService?: SemanticClassifierService,
  ) {
    this.embeddingService = embeddingService
    this.storageService = storageService
    this.classifierService = classifierService || null
  }

  /**
   * Process a completed activity: OCR selected screenshots, classify, embed, store, cleanup.
   */
  public async processActivity(activity: Activity): Promise<void> {
    const { id, screenshots } = activity
    let videoPath: string | undefined
    log.info(
      `[ActivityProcessor] Processing activity ${id}: ${activity.appName} "${activity.windowTitle}" (${screenshots.length} screenshots, ${activity.interactions.length} interactions)`,
    )

    try {
      // 1. Select screenshots for OCR: first + last + sampled intermediates (up to MAX_SCREENSHOTS_FOR_LLM)
      const selectedScreenshots = this.selectScreenshotsForLLM(screenshots)
      log.info(
        `[ActivityProcessor] Selected ${selectedScreenshots.length} of ${screenshots.length} screenshots for LLM`,
      )

      // 2. Run OCR on selected screenshots (if enabled), bounded by MAX_CONCURRENT_OCR
      let ocrTexts: string[] = []
      if (OCR_CONFIG.ENABLED) {
        ocrTexts = await this.runOcrBatch(selectedScreenshots)
      } else {
        log.info('[ActivityProcessor] OCR disabled by OCR_CONFIG.ENABLED')
      }

      // 3. Build transient MP4 from screenshots for video-first classification
      try {
        videoPath = await buildActivityVideo(activity.id, screenshots)
        log.info(`[ActivityProcessor] Built activity video: ${videoPath}`)
      } catch (error) {
        log.warn('[ActivityProcessor] Failed to build activity video:', error)
      }

      // 4. Classify activity
      let summary = ''
      if (this.classifierService) {
        try {
          summary = await this.classifierService.classifyActivity({
            activity,
            screenshotPaths: selectedScreenshots.map((s) => s.filepath),
            videoPath,
            previousSummaries: this.classifierService.getSummaryHistory(),
          })
          log.info(`[ActivityProcessor] Activity classification summary: ${summary}`)
        } catch (error) {
          log.error('[ActivityProcessor] Activity classification failed:', error)
          summary = ''
        }
      }

      // 5. Generate embedding from summary (fallback to combined OCR text)
      const embeddingText = summary || ocrTexts.join(' ')
      const vector = await this.embeddingService.generateEmbedding(embeddingText)

      // 6. Build interaction timeline for storage (same format as the LLM prompt)
      const selectedPaths = selectedScreenshots.map((s) => s.filepath)
      const interactionSummary = buildChronologicalTimeline(activity, selectedPaths)

      // 7. Store as activity
      const durationMs = (activity.endTimestamp ?? Date.now()) - activity.startTimestamp
      await this.storageService.addActivity({
        id: activity.id,
        startTimestamp: activity.startTimestamp,
        endTimestamp: activity.endTimestamp ?? Date.now(),
        appName: activity.appName,
        bundleId: activity.bundleId ?? '',
        windowTitle: activity.windowTitle,
        url: activity.url ?? null,
        tld: activity.tld ?? null,
        summary,
        ocrText: ocrTexts.join('\n---\n'),
        screenshotCount: screenshots.length,
        interactionSummary,
        durationMs,
        vector,
      })

      log.info(`[ActivityProcessor] Stored activity ${id} (${activity.appName}, ${durationMs}ms)`)

      // 8. Delete all screenshot files
      for (const screenshot of screenshots) {
        this.deleteFile(screenshot.filepath)
      }
    } catch (error) {
      log.error(`[ActivityProcessor] Error processing activity ${id}:`, error)
      throw error
    } finally {
      if (videoPath) {
        this.deleteFile(videoPath)
      }
    }
  }

  /**
   * Select screenshots for LLM: always first + last, sample up to MAX_SCREENSHOTS_FOR_LLM - 2 intermediates.
   */
  private selectScreenshotsForLLM(screenshots: Activity['screenshots']): Activity['screenshots'] {
    const max = ACTIVITY_CONFIG.MAX_SCREENSHOTS_FOR_LLM

    if (screenshots.length <= max) {
      return [...screenshots]
    }

    const result = [screenshots[0]]
    const intermediates = screenshots.slice(1, -1)
    const intermediateSlots = max - 2 // Reserve spots for first and last

    if (intermediateSlots > 0 && intermediates.length > 0) {
      const step = (intermediates.length - 1) / (intermediateSlots - 1 || 1)
      for (let i = 0; i < intermediateSlots && i < intermediates.length; i++) {
        const idx = Math.round(i * step)
        result.push(intermediates[idx])
      }
    }

    result.push(screenshots[screenshots.length - 1])
    return result
  }

  /**
   * Run OCR on a batch of screenshots with bounded concurrency.
   * Results are returned in the same order as the input array.
   */
  private async runOcrBatch(screenshots: Activity['screenshots']): Promise<string[]> {
    const maxConcurrent = OCR_CONFIG.MAX_CONCURRENT_OCR
    const results: string[] = new Array(screenshots.length).fill('')
    let nextIndex = 0

    async function worker(): Promise<void> {
      while (nextIndex < screenshots.length) {
        const idx = nextIndex++
        const screenshot = screenshots[idx]

        if (!fs.existsSync(screenshot.filepath)) {
          log.warn(`[ActivityProcessor] Screenshot file not found: ${screenshot.filepath}`)
          continue
        }

        try {
          results[idx] = await extractText(screenshot.filepath)
        } catch (error) {
          log.error(`[ActivityProcessor] OCR failed for ${screenshot.id}:`, error)
        }
      }
    }

    const workerCount = Math.min(maxConcurrent, screenshots.length)
    log.info(
      `[ActivityProcessor] Starting OCR batch: ${screenshots.length} images, ${workerCount} workers`,
    )
    const batchStart = Date.now()
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    const batchElapsed = Date.now() - batchStart
    const successCount = results.filter((t) => t.length > 0).length
    log.info(
      `[ActivityProcessor] OCR batch finished in ${batchElapsed}ms (${successCount}/${screenshots.length} succeeded)`,
    )
    return results
  }

  /**
   * Safely delete a file.
   */
  private deleteFile(filepath: string): void {
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath)
        log.info(`[ActivityProcessor] Deleted file: ${filepath}`)
      }
    } catch (error) {
      log.error(`[ActivityProcessor] Failed to delete file ${filepath}:`, error)
    }
  }

  /**
   * Get the embedding service instance (used by MCP tools for activity search).
   */
  public getEmbeddingService(): EmbeddingService {
    return this.embeddingService
  }

  /**
   * Get the storage service instance
   */
  public getStorageService(): StorageService {
    return this.storageService
  }

  /**
   * Get the classifier service instance
   */
  public getClassifierService(): SemanticClassifierService | null {
    return this.classifierService
  }
}
