import * as fs from 'fs'
import { extractText } from './ocr'
import { EmbeddingService } from './embedding'
import { StorageService, StoredEvent } from './storage'
import { Screenshot, InteractionContext, SearchOptions, SearchFilters } from '../../shared/types'
import { SemanticClassifierService } from './semantic-classifier'
import { CAPTURE_RATE_CONFIG } from '@constants'
import log from '../logger'

export class EventProcessor {
  private embeddingService: EmbeddingService
  private storageService: StorageService
  private classifierService: SemanticClassifierService | null = null

  // Event aggregation state (moved from recorder for separation of concerns)
  private pendingEvents: InteractionContext[] = []

  // Classification state - track START screenshot for START/END pairs
  private startScreenshot: Screenshot | null = null
  private startOcrText = ''

  // Processing queue to limit concurrent screenshot processing (prevents too many OCR/LLM subprocesses)
  private processingQueue: Array<{
    screenshot: Screenshot
    events: InteractionContext[]
    resolve: () => void
    reject: (error: unknown) => void
  }> = []
  private activeProcessingCount = 0

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
   * Add an interaction event to the pending events list.
   * Events are aggregated here and associated with screenshots during processing.
   */
  public addInteractionEvent(event: InteractionContext): void {
    this.pendingEvents.push(event)
  }

  /**
   * Enqueue a screenshot for processing. Concurrency is limited by
   * MAX_CONCURRENT_PROCESSING to prevent too many OCR subprocesses.
   */
  public async processScreenshot(screenshot: Screenshot): Promise<void> {
    const events = [...this.pendingEvents]
    this.pendingEvents = []

    return new Promise<void>((resolve, reject) => {
      this.processingQueue.push({ screenshot, events, resolve, reject })
      log.info(
        `[EventProcessor] Queued screenshot ${screenshot.id} with ${events.length} events (queue size: ${this.processingQueue.length}, active: ${this.activeProcessingCount})`,
      )
      void this.drainQueue()
    })
  }

  /**
   * Process queued screenshots up to MAX_CONCURRENT_PROCESSING at a time.
   */
  private async drainQueue(): Promise<void> {
    const maxConcurrent = CAPTURE_RATE_CONFIG.MAX_CONCURRENT_PROCESSING

    while (this.processingQueue.length > 0 && this.activeProcessingCount < maxConcurrent) {
      const item = this.processingQueue.shift()!
      this.activeProcessingCount++

      void this.processScreenshotInternal(item.screenshot, item.events)
        .then(() => item.resolve())
        .catch((error) => item.reject(error))
        .finally(() => {
          this.activeProcessingCount--
          void this.drainQueue()
        })
    }
  }

  /**
   * Main pipeline: OCR -> Embed -> Store -> Classification -> Cleanup
   *
   * Flow:
   * 1. OCR extracts text from screenshot (needs file)
   * 2. Generate embedding from text
   * 3. Store in database
   * 4. If classifier enabled: track START/END pairs for classification
   * 5. Classification runs (needs both screenshot files)
   * 6. Delete screenshot files after classification (or immediately if no classifier)
   */
  private async processScreenshotInternal(
    screenshot: Screenshot,
    events: InteractionContext[],
  ): Promise<void> {
    const { filepath, id } = screenshot
    log.info(
      `[EventProcessor] Processing screenshot ${id} with ${events.length} accumulated events`,
    )
    log.info(`[EventProcessor] Events: ${JSON.stringify(events)}`)

    try {
      // 1. OCR - needs the file to exist
      if (!fs.existsSync(filepath)) {
        log.warn(`File not found for screenshot ${id}: ${filepath}`)
        return
      }

      let text = ''
      try {
        text = await extractText(filepath)
        log.info(`[EventProcessor] OCR complete for ${id}. Text length: ${text.length}`)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log.error(`[EventProcessor] OCR failed for ${id}: ${errorMessage}`)
      }

      // 2. Semantic Classification (START/END pair tracking)
      if (this.classifierService) {
        if (!this.startScreenshot) {
          // This is the START screenshot - keep file and OCR for classification
          this.setStartState(screenshot, text)
        } else {
          // Check if app changed between START and END
          const appChanged = this.hasAppChange(events)

          if (appChanged) {
            // App change: use single-image classification for START only
            log.info(`[EventProcessor] App change detected, using single-image classification`)
            const summary = await this.runClassification(this.startScreenshot, undefined, events)
            await this.storeAndCleanup(
              this.startScreenshot,
              this.startOcrText,
              summary,
              events,
              'app change, single-image',
            )
          } else {
            // Normal flow: two-image classification (same app)
            const summary = await this.runClassification(this.startScreenshot, screenshot, events)
            await this.storeAndCleanup(this.startScreenshot, this.startOcrText, summary, events)
          }

          // END becomes new START (keep its file for next classification)
          this.setStartState(screenshot, text)
        }
      } else {
        // No classifier - store OCR only with empty summary, then delete
        await this.storeAndCleanup(screenshot, text, '', events, 'no classifier')
      }
    } catch (error) {
      log.error(`Error processing screenshot ${id}:`, error)
      throw error
    }
  }

  /**
   * Run classification and return summary. Handles errors gracefully.
   */
  private async runClassification(
    startScreenshot: Screenshot,
    endScreenshot: Screenshot | undefined,
    events: InteractionContext[],
  ): Promise<string> {
    log.info(`[EventProcessor] START screenshot: ${startScreenshot.id}`)
    if (endScreenshot) {
      log.info(`[EventProcessor] END screenshot: ${endScreenshot.id}`)
    }

    try {
      const summary = await this.classifierService!.classify({
        startScreenshot,
        endScreenshot,
        events,
      })
      log.info(`[EventProcessor] Classification summary: ${summary}`)
      return summary
    } catch (error) {
      log.error('[EventProcessor] Classification failed:', error)
      return 'Classification failed'
    }
  }

  /**
   * Store event to database and delete the screenshot file.
   */
  private async storeAndCleanup(
    screenshot: Screenshot,
    ocrText: string,
    summary: string,
    events: InteractionContext[],
    logSuffix?: string,
  ): Promise<void> {
    const vector = await this.embeddingService.generateEmbedding(summary || ocrText)
    const appName = this.extractAppName(events)
    const storedEvent: StoredEvent = {
      id: screenshot.id,
      timestamp: screenshot.timestamp,
      text: ocrText,
      summary,
      appName,
      vector,
    }
    await this.storageService.addEvent(storedEvent)

    const suffix = logSuffix ? ` (${logSuffix}, app: ${appName})` : ` (app: ${appName})`
    log.info(`[EventProcessor] Stored event for ${screenshot.id}${suffix}`)

    this.deleteScreenshot(screenshot.filepath)
  }

  /**
   * Update the START state for the next classification pair.
   */
  private setStartState(screenshot: Screenshot, ocrText: string): void {
    this.startScreenshot = screenshot
    this.startOcrText = ocrText
  }

  /**
   * Check if there's an app change between START and END periods.
   * Returns true if the process name changed.
   */
  private hasAppChange(events: InteractionContext[]): boolean {
    return events.some(
      (event) =>
        event.type === 'app_change' &&
        event.previousWindow?.processName !== event.activeWindow?.processName,
    )
  }

  /**
   * Extract the app name from interaction events.
   * Looks for the most common app name in the events.
   * Because theoretically the app name can change during the event.
   * For example the you have split screen with two apps and you switch between them.
   */
  private extractAppName(events: InteractionContext[]): string {
    const counts = new Map<string, number>()
    for (const event of events) {
      const name = event.activeWindow?.processName
      if (name) {
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }
    }

    let mostCommon = ''
    let maxCount = 0
    for (const [name, count] of counts) {
      if (count > maxCount) {
        mostCommon = name
        maxCount = count
      }
    }
    return mostCommon
  }

  /**
   * Safely delete a screenshot file
   */
  private deleteScreenshot(filepath: string): void {
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath)
        log.info(`[EventProcessor] Deleted screenshot: ${filepath}`)
      }
    } catch (error) {
      log.error(`[EventProcessor] Failed to delete screenshot ${filepath}:`, error)
    }
  }

  /**
   * Search for events using both vector similarity and FTS.
   */
  // TODO: review the vibecoded logic here - in searhc as well as in storage.ts
  public async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<{ fts: StoredEvent[]; vector: StoredEvent[] }> {
    const { limit = 5, startTime, endTime, appName } = options
    const filters: SearchFilters = { startTime, endTime, appName }

    log.info(`[Search] Query: "${query}" (Limit: ${limit}, Filters: ${JSON.stringify(filters)})`)

    // 1. Generate embedding for vector search
    const queryVector = await this.embeddingService.generateEmbedding(query)

    // 2. Vector search with filters
    const vectorResults = await this.storageService.searchVectorsWithFilters(
      queryVector,
      limit,
      filters,
    )
    log.info(`[Search] Vector results: ${vectorResults.length}`)

    // 3. FTS search with filters
    const ftsResults = await this.storageService.searchFTSWithFilters(query, limit, filters)
    log.info(`[Search] FTS results: ${ftsResults.length}`)

    return { fts: ftsResults, vector: vectorResults }
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
