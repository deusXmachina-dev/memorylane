/**
 * Task mining module.
 *
 * Two-phase mining that writes grounded *sightings* (task instances). It does
 * NOT match, dedup, or assign patterns — that is the deterministic clusterer's
 * job, run separately over the sightings table.
 *   Phase 1 (Scan): one LLM call over a full day's activities discovers
 *     discrete task-instance candidates, each grounded in real activity_ids.
 *   Phase 2 (Ground): each candidate gets its own tool-equipped LLM call to
 *     confirm it's a real task and finalize its activity_ids. The time window
 *     and interaction time are then COMPUTED from those activities (never
 *     LLM-estimated), the title/description are embedded, and a sighting is
 *     written.
 *
 * Includes built-in scheduling: call scheduleRun() on screen unlock and the
 * service handles interval guards, settle delays, and error isolation.
 */

import type { StorageService } from '../../storage'
import type { InferenceProvider } from '../../llm'
import { PATTERN_DETECTION_CONFIG } from '../../../shared/constants'
import log from '../../logger'
import { EmbeddingService } from '../../processor/embedding'
import type { PatternDetectorConfig, MiningRunResult, ProgressCallback } from './types'
import { DEFAULT_DETECTOR_CONFIG } from './types'
import { isSameDay, formatApiError } from './helpers'
import { runDetection } from './run-detection'

export type { PatternDetectorConfig, MiningRunResult, ProgressCallback }
export { DEFAULT_DETECTOR_CONFIG }

export class PatternDetector {
  private running = false
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private model: string = DEFAULT_DETECTOR_CONFIG.model
  private enabled = true
  private readonly embeddingService = new EmbeddingService()

  constructor(
    private readonly storage: StorageService,
    private readonly provider?: InferenceProvider,
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

    if (!this.provider || !this.provider.isConfigured()) {
      log.info('[PatternDetector] No inference provider configured, skipping')
      return
    }

    const lastRun = this.storage.miningRuns.getLastRunTimestamp()
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
    const provider = this.provider
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      void this.execute(provider)
    }, PATTERN_DETECTION_CONFIG.SETTLE_DELAY_MS)
  }

  /**
   * Run detection immediately. Used by the CLI.
   */
  async run(
    provider: InferenceProvider,
    config: Partial<PatternDetectorConfig> = {},
    onProgress?: ProgressCallback,
  ): Promise<MiningRunResult> {
    return runDetection(
      provider,
      this.storage,
      this.embeddingService,
      { model: this.model, ...config },
      onProgress,
    )
  }

  private async execute(provider: InferenceProvider): Promise<void> {
    this.running = true
    try {
      const result = await runDetection(provider, this.storage, this.embeddingService, {
        model: this.model,
      })
      log.info(
        `[TaskMiner] Run complete: ${result.sightingsFound} sightings ` +
          `(${result.candidatesRejected} rejected), ` +
          `tokens: ${result.tokenUsage.total.input}in/${result.tokenUsage.total.output}out`,
      )
    } catch (error) {
      log.error('[TaskMiner] Run failed:', formatApiError(error))
    } finally {
      this.running = false
    }
  }
}
