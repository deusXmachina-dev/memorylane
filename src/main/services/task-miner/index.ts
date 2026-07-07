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
import { PATTERN_DETECTION_CONFIG, TASK_BACKFILL } from '../../../shared/constants'
import log from '@main/utils/logger'
import { EmbeddingService } from '../../processor/embedding'
import { isSameDay, formatApiError, getDayBoundaries } from '../pattern-detector/helpers'
import type { TaskMinerConfig, MiningRunResult, ProgressCallback, BackfillSummary } from './types'
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
  private backfillPending = false
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
   * Stand the scheduled daily run down while the one-time backfill is queued or
   * running. The backfill seeds many days at once and records today's run, so a
   * concurrent daily run would be redundant — and worse, racing for the shared
   * settle timer would preempt the backfill. Set this before capture resume.
   */
  setBackfillPending(pending: boolean): void {
    this.backfillPending = pending
  }

  /**
   * Try to schedule a mining run. Call this on screen unlock / wake.
   */
  scheduleRun(): void {
    if (!this.enabled) return
    if (this.backfillPending) {
      log.info('[TaskMiner] One-time backfill pending — deferring scheduled run')
      return
    }
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

  /**
   * One-time backfill: mine `days` calendar days into sightings, then run a
   * single clustering pass. `offsetDays` shifts the window back — 0 means the
   * window ends yesterday; 20 means it ends 21 days ago. `concurrency` scans
   * that many days at once (safe: day scans are independent scan-only LLM
   * calls; each day's sightings are written by its own run). Idempotent — days
   * that already have sightings are skipped, so a prior daily run or an
   * interrupted backfill is safe to re-run. Clustering is deferred to one
   * final pass (~`days` scan calls + 1 review call, not one per day); that
   * pass is order-independent, so scan order doesn't affect cluster ids.
   * Holds the `running` guard so a scheduled run can't overlap.
   */
  async backfill(
    provider: InferenceProvider,
    opts: {
      days?: number
      offsetDays?: number
      concurrency?: number
      onProgress?: ProgressCallback
    } = {},
  ): Promise<BackfillSummary> {
    const days = opts.days ?? TASK_BACKFILL.DAYS
    const offsetDays = opts.offsetDays ?? 0
    const concurrency = Math.max(1, opts.concurrency ?? 1)

    if (!provider.isConfigured()) {
      log.info('[TaskMiner] Backfill skipped: no inference provider configured')
      return { daysMined: 0, daysSkipped: 0, daysFailed: 0, skipped: 'no-provider' }
    }
    if (this.running || this.settleTimer) {
      log.info('[TaskMiner] Backfill skipped: a mining run is already in progress')
      return { daysMined: 0, daysSkipped: 0, daysFailed: 0, skipped: 'busy' }
    }

    const progress = (msg: string) => {
      log.info(`[TaskMiner] ${msg}`)
      opts.onProgress?.(msg)
    }

    this.running = true
    try {
      let daysMined = 0
      let daysSkipped = 0
      let daysFailed = 0

      // Oldest day first, matching the sequential order at concurrency 1.
      const dayQueue: number[] = []
      for (let d = offsetDays + days; d >= offsetDays + 1; d--) dayQueue.push(d)

      const mineDay = async (d: number): Promise<void> => {
        const { start, end, label } = getDayBoundaries(d)
        if (this.storage.sightings.hasInWindow(start, end)) {
          daysSkipped++
          progress(`Backfill: ${label} already mined, skipping`)
          return
        }
        try {
          // Defer clustering — one pass at the end is far cheaper than per-day.
          await runDetection(
            provider,
            this.storage,
            this.embeddingService,
            { model: this.model, scanOnly: true, lookbackDays: d, clustering: false },
            opts.onProgress,
          )
          daysMined++
        } catch (error) {
          daysFailed++
          log.error(`[TaskMiner] Backfill day ${label} failed:`, formatApiError(error))
        }
      }

      const workers = Array.from({ length: Math.min(concurrency, dayQueue.length) }, async () => {
        for (let d = dayQueue.shift(); d !== undefined; d = dayQueue.shift()) {
          await mineDay(d)
        }
      })
      await Promise.all(workers)

      progress(
        `Backfill mined ${daysMined} day(s) (${daysSkipped} already present, ` +
          `${daysFailed} failed); running final clustering pass`,
      )
      const clustering = await this.cluster(
        provider,
        { ...DEFAULT_MINER_CONFIG, model: this.model, clustering: true },
        opts.onProgress,
      )
      return { daysMined, daysSkipped, daysFailed, clustering }
    } finally {
      this.running = false
    }
  }

  private async execute(provider: InferenceProvider): Promise<void> {
    if (this.running) {
      log.info('[TaskMiner] Run already in progress, skipping scheduled run')
      return
    }
    this.running = true
    try {
      const result = await runDetection(provider, this.storage, this.embeddingService, {
        model: this.model,
      })
      log.info(
        `[TaskMiner] Run complete: ${result.candidatesKept} sightings ` +
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
