import * as fs from 'fs'
import { extractText } from './ocr'
import { EmbeddingService } from './embedding'
import { StorageService, StoredEvent } from './storage'
import {
  Screenshot,
  InteractionContext,
  SearchOptions,
  SearchFilters,
  CompletedSession,
  SessionClassificationInput,
} from '../../shared/types'
import { SemanticClassifierService } from './semantic-classifier'
import { CAPTURE_RATE_CONFIG, SESSION_PROCESSOR_CONFIG } from '@constants'
import log from '../logger'

interface SessionQueueItem {
  session: CompletedSession
  attempts: number
  resolve: () => void
  reject: (error: unknown) => void
}

interface SessionOcrEntry {
  screenshot: Screenshot
  text: string
}

export class EventProcessor {
  private embeddingService: EmbeddingService
  private storageService: StorageService
  private classifierService: SemanticClassifierService | null = null

  // Legacy event aggregation for screenshot-based compatibility paths.
  private pendingEvents: InteractionContext[] = []

  // Session processing queue to keep OCR/LLM work bounded.
  private processingQueue: SessionQueueItem[] = []
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
   * This is kept for backward compatibility with screenshot-based pipelines.
   */
  public addInteractionEvent(event: InteractionContext): void {
    this.pendingEvents.push(event)
  }

  /**
   * Backward-compatible wrapper for old screenshot-based producers.
   * Converts a screenshot + pending events into a one-screenshot session.
   */
  public async processScreenshot(screenshot: Screenshot): Promise<void> {
    const events = [...this.pendingEvents]
    this.pendingEvents = []

    const session: CompletedSession = {
      sessionId: screenshot.id,
      appName: this.extractAppName(events),
      startTimestamp: screenshot.timestamp,
      endTimestamp: screenshot.timestamp,
      screenshots: [screenshot],
      interactionEvents: events,
      endReason: 'stop',
    }

    return this.processSession(session)
  }

  /**
   * Enqueue a completed session for processing.
   */
  public async processSession(session: CompletedSession): Promise<void> {
    const normalizedSession = this.normalizeSession(session)
    return new Promise<void>((resolve, reject) => {
      this.processingQueue.push({
        session: normalizedSession,
        attempts: 0,
        resolve,
        reject,
      })
      log.info(
        `[EventProcessor] Queued session ${normalizedSession.sessionId} with ` +
          `${normalizedSession.screenshots.length} screenshots and ` +
          `${normalizedSession.interactionEvents.length} events ` +
          `(queue size: ${this.processingQueue.length}, active: ${this.activeProcessingCount})`,
      )
      void this.drainQueue()
    })
  }

  /**
   * Process queued sessions up to MAX_CONCURRENT_PROCESSING at a time.
   */
  private async drainQueue(): Promise<void> {
    const maxConcurrent = CAPTURE_RATE_CONFIG.MAX_CONCURRENT_PROCESSING

    while (this.processingQueue.length > 0 && this.activeProcessingCount < maxConcurrent) {
      const item = this.processingQueue.shift()!
      this.activeProcessingCount++

      void this.processSessionQueueItem(item).finally(() => {
        this.activeProcessingCount--
        void this.drainQueue()
      })
    }
  }

  /**
   * Runs one queue item with retry behavior.
   */
  private async processSessionQueueItem(item: SessionQueueItem): Promise<void> {
    const attemptNumber = item.attempts + 1
    const maxAttempts = SESSION_PROCESSOR_CONFIG.MAX_SESSION_PROCESSING_RETRIES + 1

    try {
      log.info(
        `[EventProcessor] Processing session ${item.session.sessionId} ` +
          `(attempt ${attemptNumber}/${maxAttempts})`,
      )
      await this.processSessionInternal(item.session)
      item.resolve()
    } catch (error) {
      if (item.attempts < SESSION_PROCESSOR_CONFIG.MAX_SESSION_PROCESSING_RETRIES) {
        item.attempts++
        const reason = error instanceof Error ? error.message : String(error)
        log.warn(
          `[EventProcessor] Session ${item.session.sessionId} failed ` +
            `(attempt ${attemptNumber}/${maxAttempts}): ${reason}. Retrying...`,
        )
        this.processingQueue.push(item)
        return
      }

      log.error(
        `[EventProcessor] Session ${item.session.sessionId} failed permanently after ` +
          `${maxAttempts} attempts:`,
        error,
      )
      item.reject(error)
    }
  }

  /**
   * Main session pipeline:
   * 1. OCR all screenshots (chronological)
   * 2. Build deterministic session text from OCR
   * 3. Summarize the full session with bounded frame inputs
   * 4. Embed summary (or OCR fallback)
   * 5. Persist one row
   * 6. Cleanup screenshots after successful store
   */
  private async processSessionInternal(session: CompletedSession): Promise<void> {
    const ocrEntries: SessionOcrEntry[] = []
    for (const screenshot of session.screenshots) {
      const text = await this.extractOcrForScreenshot(screenshot)
      ocrEntries.push({ screenshot, text })
    }

    const aggregatedOcrText = this.buildAggregatedSessionText(ocrEntries)
    const llmScreenshots = this.selectScreenshotsForLlm(
      session.screenshots,
      SESSION_PROCESSOR_CONFIG.MAX_LLM_IMAGES_PER_SESSION,
    )

    let summary = ''
    if (this.classifierService && llmScreenshots.length > 0) {
      const sessionInput: SessionClassificationInput = {
        sessionId: session.sessionId,
        appName: session.appName,
        startTimestamp: session.startTimestamp,
        endTimestamp: session.endTimestamp,
        screenshots: llmScreenshots,
        interactionEvents: session.interactionEvents,
        ocrText: aggregatedOcrText,
      }
      summary = await this.summarizeSession(sessionInput)
    } else if (!this.classifierService) {
      log.info('[EventProcessor] Skipping session summary - classifier disabled')
    }

    const embeddingSource = summary.trim().length > 0 ? summary : aggregatedOcrText
    const vector = await this.embeddingService.generateEmbedding(embeddingSource)
    const appName = session.appName || this.extractAppName(session.interactionEvents)
    const storedEvent: StoredEvent = {
      id: session.sessionId,
      timestamp: session.startTimestamp,
      text: aggregatedOcrText,
      summary,
      appName,
      vector,
    }
    await this.storageService.addEvent(storedEvent)

    log.info(
      `[EventProcessor] Stored session event ${session.sessionId} ` +
        `(screenshots: ${session.screenshots.length}, app: ${appName}, summaryLength: ${summary.length})`,
    )

    this.deleteScreenshots(session.screenshots)
  }

  /**
   * Sort screenshot/event arrays and normalize timestamp bounds.
   */
  private normalizeSession(session: CompletedSession): CompletedSession {
    const screenshots = [...session.screenshots].sort((a, b) => a.timestamp - b.timestamp)
    const interactionEvents = [...session.interactionEvents].sort(
      (a, b) => a.timestamp - b.timestamp,
    )
    const firstTimestamp = screenshots[0]?.timestamp ?? session.startTimestamp
    const lastTimestamp = screenshots[screenshots.length - 1]?.timestamp ?? session.endTimestamp

    return {
      ...session,
      screenshots,
      interactionEvents,
      startTimestamp: Math.min(session.startTimestamp, firstTimestamp),
      endTimestamp: Math.max(session.endTimestamp, lastTimestamp),
    }
  }

  /**
   * OCR a single screenshot with tolerant error handling.
   */
  private async extractOcrForScreenshot(screenshot: Screenshot): Promise<string> {
    if (!fs.existsSync(screenshot.filepath)) {
      log.warn(
        `[EventProcessor] Screenshot file missing for OCR ` +
          `(${screenshot.id}): ${screenshot.filepath}`,
      )
      return ''
    }

    try {
      const text = await extractText(screenshot.filepath)
      log.info(`[EventProcessor] OCR complete for ${screenshot.id}. Text length: ${text.length}`)
      return text
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error(`[EventProcessor] OCR failed for ${screenshot.id}: ${errorMessage}`)
      return ''
    }
  }

  /**
   * Concatenate OCR chunks in a deterministic, chronologically ordered format.
   */
  private buildAggregatedSessionText(ocrEntries: SessionOcrEntry[]): string {
    if (ocrEntries.length === 0) return ''

    return ocrEntries
      .map((entry, index) => {
        const header =
          `[FRAME ${index + 1}/${ocrEntries.length}] ` +
          `timestamp=${entry.screenshot.timestamp} id=${entry.screenshot.id}`
        const body = entry.text.trim().length > 0 ? entry.text.trim() : '[NO_OCR_TEXT]'
        return `${header}\n${body}`
      })
      .join('\n\n')
  }

  /**
   * Select frames for LLM input with deterministic first/last + sampled middle frames.
   */
  private selectScreenshotsForLlm(screenshots: Screenshot[], cap: number): Screenshot[] {
    if (screenshots.length === 0 || cap <= 0) return []
    if (screenshots.length <= cap) return [...screenshots]
    if (cap === 1) return [screenshots[0]]
    if (cap === 2) return [screenshots[0], screenshots[screenshots.length - 1]]

    const total = screenshots.length
    const middleStart = 1
    const middleEnd = total - 2
    const middleCount = middleEnd - middleStart + 1
    const middleSlots = cap - 2
    const selectedIndices = new Set<number>([0, total - 1])

    for (let i = 1; i <= middleSlots; i++) {
      const position = (i * (middleCount + 1)) / (middleSlots + 1)
      const candidate = middleStart + Math.round(position) - 1
      const clamped = Math.max(middleStart, Math.min(middleEnd, candidate))
      selectedIndices.add(clamped)
    }

    if (selectedIndices.size < cap) {
      for (let idx = middleStart; idx <= middleEnd && selectedIndices.size < cap; idx++) {
        selectedIndices.add(idx)
      }
    }

    return [...selectedIndices]
      .sort((a, b) => a - b)
      .slice(0, cap)
      .map((idx) => screenshots[idx])
  }

  /**
   * Run session-level summarization and return summary text.
   * Returns empty summary on classifier failures so storage can continue.
   */
  private async summarizeSession(input: SessionClassificationInput): Promise<string> {
    if (!this.classifierService) return ''

    try {
      const summary = await this.classifierService.summarizeSession(input)
      log.info(`[EventProcessor] Session summary: ${summary}`)
      return summary
    } catch (error) {
      log.error('[EventProcessor] Session summarization failed:', error)
      return ''
    }
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
   * Delete session screenshots after successful storage.
   */
  private deleteScreenshots(screenshots: Screenshot[]): void {
    const uniqueFilepaths = [...new Set(screenshots.map((s) => s.filepath))]
    uniqueFilepaths.forEach((filepath) => {
      this.deleteScreenshot(filepath)
    })
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
