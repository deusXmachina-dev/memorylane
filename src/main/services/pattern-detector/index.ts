/**
 * Pattern detection module.
 *
 * Two-phase agentic detection:
 *   Phase 1 (Scan): Sends a full day's activities in a single LLM call to
 *     discover candidate patterns. Includes top rejected patterns as negative
 *     examples but does NOT include existing patterns (that's Phase 2's job).
 *   Phase 2 (Verify): Each candidate gets its own LLM call with tool access
 *     to OCR text and semantic search. The verifier also receives all existing
 *     patterns and decides whether the candidate is a re-sighting, a new
 *     pattern, or should be discarded. Runs sequentially so each verifier
 *     sees patterns created by previous candidates.
 *
 * Includes built-in scheduling: call scheduleRun() on screen unlock and the
 * service handles interval guards, settle delays, and error isolation.
 */

import type { LanguageModel } from 'ai'
import type { StorageService } from '../../storage'
import type { ProviderResolver } from '../../llm'
import { getCapabilities } from '../../llm'
import { PATTERN_DETECTION_CONFIG } from '../../../shared/constants'
import log from '../../logger'
import { EmbeddingService } from '../../processor/embedding'
import type { PatternDetectorConfig, DetectionRunResult, ProgressCallback } from './types'
import { DEFAULT_DETECTOR_CONFIG } from './types'
import { isSameDay, formatApiError } from './helpers'
import { runDetection } from './run-detection'

export type { PatternDetectorConfig, DetectionRunResult, ProgressCallback }
export { DEFAULT_DETECTOR_CONFIG }
export { extractFindingsFromResponse } from './helpers'

export class PatternDetector {
  private running = false
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private model: string = DEFAULT_DETECTOR_CONFIG.model
  private enabled = true
  private readonly embeddingService = new EmbeddingService()

  constructor(
    private readonly storage: StorageService,
    private readonly resolver?: ProviderResolver,
  ) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    log.info(`[PatternDetector] ${enabled ? 'Enabled' : 'Disabled'}`)
  }

  updateModel(model: string): void {
    this.model = model && model.trim().length > 0 ? model.trim() : DEFAULT_DETECTOR_CONFIG.model
    log.info(`[PatternDetector] Model updated to: ${this.model}`)
  }

  /**
   * Try to schedule a detection run. Call this on screen unlock / wake.
   */
  scheduleRun(): void {
    if (!this.enabled) return
    if (this.running || this.settleTimer) return

    if (!this.resolver) {
      log.info('[PatternDetector] No resolver, skipping')
      return
    }

    const active = this.resolver.getActive()
    if (!active) {
      log.info('[PatternDetector] No active provider, skipping')
      return
    }

    if (!getCapabilities(active.kind).toolUse) {
      log.info(
        `[PatternDetector] Active provider (${active.kind}) does not support tool use, skipping`,
      )
      return
    }

    let languageModel: LanguageModel
    try {
      languageModel = this.resolver.buildActive(this.model)
    } catch (err) {
      log.info(`[PatternDetector] Cannot build model: ${(err as Error).message}, skipping`)
      return
    }

    const lastRun = this.storage.patterns.getLastRunTimestamp()
    if (lastRun && isSameDay(lastRun, Date.now())) {
      log.info('[PatternDetector] Already ran today, skipping')
      return
    }

    const activityCount = this.storage.activities.count()
    if (activityCount < PATTERN_DETECTION_CONFIG.MIN_ACTIVITIES) {
      log.info(
        `[PatternDetector] Only ${activityCount} activities (need ${PATTERN_DETECTION_CONFIG.MIN_ACTIVITIES}), skipping`,
      )
      return
    }

    log.info(
      `[PatternDetector] Scheduling run in ${PATTERN_DETECTION_CONFIG.SETTLE_DELAY_MS / 1000}s`,
    )
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      void this.execute(languageModel)
    }, PATTERN_DETECTION_CONFIG.SETTLE_DELAY_MS)
  }

  /**
   * Run detection immediately. Used by the CLI.
   */
  async run(
    model: LanguageModel,
    config: Partial<PatternDetectorConfig> = {},
    onProgress?: ProgressCallback,
  ): Promise<DetectionRunResult> {
    return runDetection(model, this.storage, this.embeddingService, config, onProgress)
  }

  private async execute(model: LanguageModel): Promise<void> {
    this.running = true
    try {
      const result = await runDetection(model, this.storage, this.embeddingService, {
        model: this.model,
      })
      log.info(
        `[PatternDetector] Run complete: ${result.totalFindings} findings ` +
          `(${result.newPatterns} new, ${result.updatedPatterns} updated), ` +
          `tokens: ${result.tokenUsage.total.input}in/${result.tokenUsage.total.output}out`,
      )
    } catch (error) {
      log.error('[PatternDetector] Run failed:', formatApiError(error))
    } finally {
      this.running = false
    }
  }
}
