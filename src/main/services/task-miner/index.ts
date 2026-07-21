/**
 * Task mining module (the scheduled background miner).
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
import { formatApiError, getDayBoundaries } from '../pattern-detector/helpers'
import type {
  TaskMinerConfig,
  MiningRunResult,
  ProgressCallback,
  BackfillSummary,
  MinerEmbedder,
} from './types'
import { DEFAULT_MINER_CONFIG } from './types'
import { runDetection } from './run-detection'
import { runClustering } from './clustering'
import type { ClusteringRunSummary } from './clustering'

export type { TaskMinerConfig, MiningRunResult, ProgressCallback }
export type { ClusteringRunSummary }
export { DEFAULT_MINER_CONFIG }

export class TaskMiner {
  private running = false
  /** Settled counts snapshotted at sweep start; null outside a sweep. */
  private sweepBaseline: { completed: number; failed: number } | null = null
  private settleTimer: ReturnType<typeof setTimeout> | null = null
  private model: string = DEFAULT_MINER_CONFIG.model
  /** Remote override for the clustering (label/merge/split) passes; null = follow `model`. */
  private clusterModel: string | null = null
  private enabled = true
  private statusListener?: () => void
  /** Set by cancelSweep(); the sweep loop bails at the next day boundary. */
  private abortRequested = false
  private currentSweep: Promise<BackfillSummary> | null = null

  // The app injects the MlWorkerClient; enode scripts pass an in-process
  // EmbeddingService (no utilityProcess there). Not defaulted — a default
  // `new EmbeddingService()` would drag transformers.js back into the
  // main-process bundle this class is part of.
  constructor(
    private readonly storage: StorageService,
    private readonly provider: InferenceProvider | undefined,
    private readonly embedder: MinerEmbedder,
  ) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    log.info(`[TaskMiner] ${enabled ? 'Enabled' : 'Disabled'}`)
  }

  updateModel(model: string): void {
    this.model = model && model.trim().length > 0 ? model.trim() : DEFAULT_MINER_CONFIG.model
    log.info(`[TaskMiner] Model updated to: ${this.model}`)
  }

  updateClusterModel(model: string | null): void {
    this.clusterModel = model && model.trim().length > 0 ? model.trim() : null
    log.info(`[TaskMiner] Cluster model updated to: ${this.clusterModel ?? '(follow miner model)'}`)
  }

  /** True while a run is executing or its settle timer is armed. */
  isBusy(): boolean {
    return this.running || this.settleTimer !== null
  }

  /** Settled counts at the current sweep's start, for per-run progress; null outside a sweep. */
  getSweepBaseline(): { completed: number; failed: number } | null {
    return this.sweepBaseline
  }

  /** Notified whenever the mining ledger changes (day claimed/finished, sweep start/end). */
  setStatusListener(listener: () => void): void {
    this.statusListener = listener
  }

  private emitStatus(): void {
    this.statusListener?.()
  }

  /**
   * Startup entry point: recover days left `running` by a crash, then try to
   * schedule a sweep (the settle timer keeps the launch path calm and a fresh
   * DB starts its 60-day seed without waiting for the first unlock).
   */
  startup(): void {
    const recovered = this.storage.miningDays.resetStaleRunning(TASK_BACKFILL.MAX_DAY_ATTEMPTS)
    if (recovered) log.info(`[TaskMiner] Recovered ${recovered} interrupted mining day(s)`)
    this.scheduleRun()
  }

  /**
   * Try to schedule a mining sweep. Call this on screen unlock / wake.
   */
  scheduleRun(): void {
    if (!this.enabled) return
    if (this.running || this.settleTimer) return

    if (!this.provider || !this.provider.isConfigured()) {
      log.info('[TaskMiner] No inference provider configured, skipping')
      return
    }

    const activityCount = this.storage.activities.count()
    if (activityCount < PATTERN_DETECTION_CONFIG.MIN_ACTIVITIES) {
      log.info(
        `[TaskMiner] Only ${activityCount} activities (need ${PATTERN_DETECTION_CONFIG.MIN_ACTIVITIES}), skipping`,
      )
      return
    }

    this.ensureEnqueued()
    if (!this.storage.miningDays.hasPending()) {
      log.info('[TaskMiner] No days pending, skipping')
      return
    }

    log.info(`[TaskMiner] Scheduling sweep in ${PATTERN_DETECTION_CONFIG.SETTLE_DELAY_MS / 1000}s`)
    const provider = this.provider
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null
      void this.sweep(provider)
    }, PATTERN_DETECTION_CONFIG.SETTLE_DELAY_MS)
  }

  /**
   * Enqueue every unmined day from the last `TASK_BACKFILL.DAYS` calendar days
   * (bounded by the oldest activity) as pending ledger rows. This one rule is
   * the first-launch backfill (empty ledger → up to 60 pending days), the
   * daily enqueue (yesterday), and the gap-fill after downtime — no special
   * cases. Days already in the ledger, whatever their status, are untouched.
   */
  private ensureEnqueued(): number {
    const oldest = this.storage.activities.getDateRange().oldest
    if (oldest === null) return 0
    const days: string[] = []
    for (let back = TASK_BACKFILL.DAYS; back >= 1; back--) {
      const { end, label } = getDayBoundaries(back)
      if (end < oldest) continue
      days.push(label)
    }
    const added = this.storage.miningDays.enqueueMissing(days)
    if (added > 0) log.info(`[TaskMiner] Enqueued ${added} day(s) for mining`)
    return added
  }

  /** Days back from today for a 'YYYY-MM-DD' ledger day (local calendar). */
  private daysAgo(day: string): number {
    const [y, m, d] = day.split('-').map(Number)
    const now = new Date()
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const dayMidnight = new Date(y, m - 1, d).getTime()
    return Math.round((todayMidnight - dayMidnight) / 86_400_000)
  }

  /**
   * Drain the ledger: claim pending days oldest-first (earlier days' cluster
   * labels feed the known-procedure vocabulary later days scan against) and
   * mine each one. A day's sightings and its `completed` status commit in one
   * transaction (see runDetection.onCommit), so a crash retries cleanly. A
   * failed day records the attempt and stops the sweep — the next trigger
   * retries it, and once its attempts are exhausted the claim skips past it.
   * Clusters at the CLUSTER_EVERY_DAYS barrier and once at the end.
   */
  private sweep(provider: InferenceProvider): Promise<BackfillSummary> {
    if (this.running) {
      log.info('[TaskMiner] Sweep already in progress, skipping')
      return Promise.resolve({ daysMined: 0, daysSkipped: 0, daysFailed: 0, skipped: 'busy' })
    }
    const sweep = this.runSweep(provider).finally(() => {
      if (this.currentSweep === sweep) this.currentSweep = null
    })
    this.currentSweep = sweep
    return sweep
  }

  /**
   * Preempt the miner: clear any scheduled sweep and stop the running one at
   * its next day boundary (the in-flight day finishes — aborting a single LLM
   * call mid-commit isn't worth the plumbing). Resolves once the miner is
   * idle. Backs the dev "wipe & re-mine" flow, which must not race a sweep
   * committing days into the freshly wiped ledger.
   */
  async cancelSweep(): Promise<void> {
    if (this.settleTimer) {
      clearTimeout(this.settleTimer)
      this.settleTimer = null
    }
    while (this.currentSweep) {
      this.abortRequested = true
      await this.currentSweep.catch(() => {})
    }
    this.abortRequested = false
  }

  private async runSweep(provider: InferenceProvider): Promise<BackfillSummary> {
    this.running = true
    const settled = this.storage.miningDays.countByStatus()
    this.sweepBaseline = { completed: settled.completed, failed: settled.failed }
    this.emitStatus()
    try {
      let daysMined = 0
      let daysSkipped = 0
      let daysFailed = 0
      let minedSinceCluster = 0
      let didWork = false
      let clustering: ClusteringRunSummary | undefined

      for (;;) {
        if (this.abortRequested) {
          log.info('[TaskMiner] Sweep cancelled')
          break
        }
        const claim = this.storage.miningDays.claimOldestPending()
        if (!claim) break
        didWork = true
        // Push the claim so the banner's currentDay is live while the day mines.
        this.emitStatus()
        const back = this.daysAgo(claim.day)
        const { start, end } = getDayBoundaries(back)

        // Mined outside the ledger (CLI backfill, pre-ledger runs): record it
        // as done rather than writing duplicate sightings.
        if (this.storage.sightings.hasInWindow(start, end)) {
          this.storage.miningDays.markCompleted(claim.day, { skippedReason: 'had-sightings' })
          daysSkipped++
          this.emitStatus()
          continue
        }

        try {
          await runDetection(provider, this.storage, this.embedder, {
            model: this.model,
            scanOnly: true,
            clustering: false,
            lookbackDays: back,
            onCommit: (stats) => this.storage.miningDays.markCompleted(claim.day, { ...stats }),
          })
          daysMined++
          minedSinceCluster++
          const counts = this.storage.miningDays.countByStatus()
          log.info(
            `[TaskMiner] Day ${claim.day} completed (attempt ${claim.attempts}) — ` +
              `${counts.completed} done, ${counts.pending} pending, ${counts.failed} failed`,
          )
        } catch (error) {
          const message = formatApiError(error)
          this.storage.miningDays.markAttemptFailed(
            claim.day,
            message,
            TASK_BACKFILL.MAX_DAY_ATTEMPTS,
          )
          daysFailed++
          log.error(
            `[TaskMiner] Day ${claim.day} failed (attempt ${claim.attempts}/${TASK_BACKFILL.MAX_DAY_ATTEMPTS}): ${message}`,
          )
          this.emitStatus()
          // Stop the sweep: the next trigger retries, and a provider outage
          // isn't hammered once per remaining day.
          break
        }
        this.emitStatus()

        if (!this.abortRequested && minedSinceCluster >= TASK_BACKFILL.CLUSTER_EVERY_DAYS) {
          clustering = await this.cluster(provider, {
            ...DEFAULT_MINER_CONFIG,
            model: this.model,
            clustering: true,
          })
          minedSinceCluster = 0
        }
      }

      // Final clustering pass — also after an all-skipped drain, so a ledger
      // enqueued over pre-ledger sightings still gets its clusters refreshed.
      // Skipped when nothing settled (e.g. the first day failed): there is
      // nothing new to cluster, and a provider outage shouldn't get one more
      // doomed LLM call.
      if (
        !this.abortRequested &&
        daysMined + daysSkipped > 0 &&
        (minedSinceCluster > 0 || !clustering)
      ) {
        clustering = await this.cluster(provider, {
          ...DEFAULT_MINER_CONFIG,
          model: this.model,
          clustering: true,
        })
      }

      if (didWork) {
        log.info(
          `[TaskMiner] Sweep complete: ${daysMined} day(s) mined, ` +
            `${daysSkipped} already present, ${daysFailed} failed`,
        )
      }
      return { daysMined, daysSkipped, daysFailed, clustering }
    } finally {
      this.running = false
      this.sweepBaseline = null
      this.emitStatus()
    }
  }

  /**
   * Enqueue and drain the ledger immediately, bypassing the settle timer.
   * Backs the dev "wipe & re-mine" flow.
   */
  async sweepNow(provider: InferenceProvider): Promise<BackfillSummary> {
    if (!provider.isConfigured()) {
      return { daysMined: 0, daysSkipped: 0, daysFailed: 0, skipped: 'no-provider' }
    }
    this.ensureEnqueued()
    return this.sweep(provider)
  }

  /**
   * Deterministic re-bootstrap after a derived-data wipe (CLUSTER_SCHEMA_VERSION bump):
   * regroups existing sightings at startup so the Patterns view isn't blank
   * until the next scheduled mining run. Reviews with the LLM only when
   * mining is enabled and a provider is configured — otherwise unlabeled
   * clusters fall back to member titles.
   */
  async rebuildClustersIfEmpty(): Promise<void> {
    if (this.running) return
    if (this.storage.clusters.getAll().length > 0) return
    // Unattached signatures count as pending work too: a crash between
    // signing and grouping leaves every sighting "processed" while zero
    // clusters exist, and getUnprocessedSightings can't see that state.
    if (
      this.storage.clusters.getUnprocessedSightings().length === 0 &&
      this.storage.clusters.getUnattachedSignatures().size === 0
    )
      return
    this.running = true
    try {
      await runClustering({
        storage: this.storage,
        embedder: this.embedder,
        clusterVectors: this.embedder.clusterVectors?.bind(this.embedder),
        provider: this.enabled && this.provider?.isConfigured() ? this.provider : undefined,
        model: this.clusterModel ?? this.model,
      })
    } catch (error) {
      log.error('[TaskMiner] Cluster rebuild failed:', formatApiError(error))
    } finally {
      this.running = false
    }
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
    const result = await runDetection(provider, this.storage, this.embedder, cfg, onProgress)
    result.clustering = await this.cluster(provider, cfg, onProgress)
    return result
  }

  /**
   * CLI-only multi-day backfill (`scripts/mine-tasks.ts`); the app itself
   * mines through the mining_days ledger sweep instead. Days mined here are
   * absorbed by the sweep's had-sightings short-circuit, never re-mined.
   *
   * Mines `days` calendar days into sightings, oldest first,
   * clustering at a `CLUSTER_EVERY_DAYS` barrier so each chunk's labels become
   * known-procedure vocabulary for the next chunk (canonical titles cross-day).
   * `offsetDays` shifts the window back — 0 means the window ends yesterday; 20
   * means it ends 21 days ago. `concurrency` scans that many days at once within
   * a chunk (safe: day scans are independent scan-only LLM calls; each day's
   * sightings are written by its own run). Idempotent — days that already have
   * sightings are skipped, so a prior daily run or an interrupted backfill is
   * safe to re-run; a chunk that mines nothing new skips its clustering pass.
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

      // Oldest day first: earlier days cluster first, so their labels feed the
      // known-procedure vocabulary the later, more-recent days scan against.
      const allDays: number[] = []
      for (let d = offsetDays + days; d >= offsetDays + 1; d--) allDays.push(d)

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
            this.embedder,
            { model: this.model, scanOnly: true, lookbackDays: d, clustering: false },
            opts.onProgress,
          )
          daysMined++
        } catch (error) {
          daysFailed++
          log.error(`[TaskMiner] Backfill day ${label} failed:`, formatApiError(error))
        }
      }

      // Mine in oldest-first chunks, clustering at each chunk barrier so the
      // labels earned so far become known-procedure vocabulary for the next
      // chunk's scans. Concurrency still applies within a chunk; the barrier
      // keeps clustering off the wire while day scans are in flight.
      const chunkSize = Math.max(1, TASK_BACKFILL.CLUSTER_EVERY_DAYS)
      let clustering: ClusteringRunSummary | undefined
      for (let i = 0; i < allDays.length; i += chunkSize) {
        const queue = allDays.slice(i, i + chunkSize)
        const minedBefore = daysMined
        const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
          for (let d = queue.shift(); d !== undefined; d = queue.shift()) {
            await mineDay(d)
          }
        })
        await Promise.all(workers)

        // Skip the barrier pass when the chunk mined nothing new (idempotent
        // re-run), but always cluster once on the final chunk so a fully-skipped
        // resume still refreshes clusters.
        const isLastChunk = i + chunkSize >= allDays.length
        if (daysMined > minedBefore || isLastChunk) {
          progress(`Backfill: ${daysMined} day(s) mined so far; clustering`)
          clustering = await this.cluster(
            provider,
            { ...DEFAULT_MINER_CONFIG, model: this.model, clustering: true },
            opts.onProgress,
          )
        }
      }

      progress(
        `Backfill mined ${daysMined} day(s) (${daysSkipped} already present, ${daysFailed} failed)`,
      )
      return { daysMined, daysSkipped, daysFailed, clustering }
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
        embedder: this.embedder,
        clusterVectors: this.embedder.clusterVectors?.bind(this.embedder),
        provider,
        model: this.clusterModel ?? cfg.model,
        onProgress,
      })
    } catch (error) {
      log.error('[TaskMiner] Clustering failed:', formatApiError(error))
      return undefined
    }
  }
}
