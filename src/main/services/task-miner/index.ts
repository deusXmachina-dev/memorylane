/**
 * Task mining module (in development behind the ML_TASK_MINING flag).
 *
 * Mining that writes grounded *sightings* (task instances). It does NOT
 * match, dedup, or assign patterns — sightings are append-only and carved
 * in stone.
 *   Phase 1 (Scan): one LLM call over a full day's activities discovers
 *     discrete task-instance candidates, each grounded in real activity_ids.
 *   Phase 2 (Ground): optional per-candidate tool-equipped LLM confirmation.
 *     OFF by default (scanOnly) — the eval sweep showed grounding lowers
 *     recall at higher cost (findings/task-mining-benchmark.md).
 * The time window and interaction time are COMPUTED from the final activities
 * (never LLM-estimated) before each sighting is written.
 *
 * After mining, a clustering pass (see ./clustering) groups sightings into
 * persistent recurring-process clusters with stable ids.
 *
 * Includes built-in scheduling: call scheduleRun() on screen unlock and the
 * service handles interval guards, settle delays, and error isolation.
 *
 * Mirrors the public surface of PatternDetector so it can be swapped in by the
 * scheduler/coordinator when the flag is on. The existing pattern detector is
 * left completely untouched.
 */

import type { StorageService } from '../../storage'
import type { InferenceProvider } from '../../llm'
import { PATTERN_DETECTION_CONFIG } from '../../../shared/constants'
import log from '@main/utils/logger'
import { EmbeddingService } from '../../processor/embedding'
import { isSameDay, formatApiError } from '../pattern-detector/helpers'
import type { TaskMinerConfig, MiningRunResult, ProgressCallback } from './types'
import { DEFAULT_MINER_CONFIG } from './types'
import { runDetection } from './run-detection'
import { runClustering } from './clustering'
import type { ClusteringRunSummary } from './clustering'

export type { TaskMinerConfig, MiningRunResult, ProgressCallback }
export type { ClusteringRunSummary }
export { DEFAULT_MINER_CONFIG }

export class TaskMiner {
  private running = false
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private model: string = DEFAULT_MINER_CONFIG.model
  private enabled = true
  private readonly embeddingService = new EmbeddingService()

  constructor(
    private readonly storage: StorageService,
    private readonly provider?: InferenceProvider,
  ) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    log.info(`[TaskMiner] ${enabled ? 'Enabled' : 'Disabled'}`)
  }

  updateModel(model: string): void {
    this.model = model && model.trim().length > 0 ? model.trim() : DEFAULT_MINER_CONFIG.model
    log.info(`[TaskMiner] Model updated to: ${this.model}`)
  }

  /**
   * Try to schedule a mining run. Call this on screen unlock / wake.
   */
  scheduleRun(): void {
    if (!this.enabled) return
    if (this.running || this.settleTimer) return

    if (!this.provider || !this.provider.isConfigured()) {
      log.info('[TaskMiner] No inference provider configured, skipping')
      return
    }

    const lastRun = this.storage.miningRuns.getLastRunTimestamp()
    if (lastRun && isSameDay(lastRun, Date.now())) {
      log.info('[TaskMiner] Already ran today, skipping')
      return
    }

    const activityCount = this.storage.activities.count()
    if (activityCount < PATTERN_DETECTION_CONFIG.MIN_ACTIVITIES) {
      log.info(
        `[TaskMiner] Only ${activityCount} activities (need ${PATTERN_DETECTION_CONFIG.MIN_ACTIVITIES}), skipping`,
      )
      return
    }

    log.info(`[TaskMiner] Scheduling run in ${PATTERN_DETECTION_CONFIG.SETTLE_DELAY_MS / 1000}s`)
    const provider = this.provider
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      void this.execute(provider)
    }, PATTERN_DETECTION_CONFIG.SETTLE_DELAY_MS)
  }

  /**
   * Run mining immediately. Used by the CLI.
   */
  async run(
    provider: InferenceProvider,
    config: Partial<TaskMinerConfig> = {},
    onProgress?: ProgressCallback,
  ): Promise<MiningRunResult> {
    const cfg = { ...DEFAULT_MINER_CONFIG, model: this.model, ...config }
    const result = await runDetection(
      provider,
      this.storage,
      this.embeddingService,
      cfg,
      onProgress,
    )
    result.clustering = await this.cluster(provider, cfg, onProgress)
    return result
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
      const clustering = await this.cluster(provider, {
        ...DEFAULT_MINER_CONFIG,
        model: this.model,
      })
      if (clustering) {
        log.info(
          `[TaskMiner] Clustering complete: +${clustering.attached} attached, ` +
            `${clustering.newClusters} new clusters, ${clustering.labeled} labeled` +
            (clustering.llmError ? ` (LLM review failed: ${clustering.llmError})` : ''),
        )
      }
    } catch (error) {
      log.error('[TaskMiner] Run failed:', formatApiError(error))
    } finally {
      this.running = false
    }
  }

  /**
   * Post-mining clustering pass. Isolated so a clustering failure never marks
   * the mining run failed — sightings are already written, and every
   * deterministic clustering step commits independently, so the next run
   * resumes cleanly.
   */
  private async cluster(
    provider: InferenceProvider,
    cfg: TaskMinerConfig,
    onProgress?: ProgressCallback,
  ): Promise<ClusteringRunSummary | undefined> {
    if (!cfg.clustering) return undefined
    try {
      return await runClustering({
        storage: this.storage,
        provider,
        model: cfg.model,
        onProgress,
      })
    } catch (error) {
      log.error('[TaskMiner] Clustering failed:', formatApiError(error))
      return undefined
    }
  }
}
