import { PATTERN_DETECTION_CONFIG } from '../../../shared/constants'
import type { ClusteringRunSummary } from './clustering/types'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface TaskMinerConfig {
  model: string
  lookbackDays: number
  /** Skip Phase 2 (per-candidate tool-equipped grounding); scan output is final. */
  scanOnly: boolean
  /** Run the clustering pass over sightings after mining. */
  clustering: boolean
  /**
   * Called inside the transaction that persists the day's sightings, so ledger
   * bookkeeping (mining_days markCompleted) commits atomically with them.
   */
  onCommit?: (stats: DayMiningStats) => void
}

/** Per-day outcome persisted to the mining_days ledger. */
export interface DayMiningStats {
  candidatesFromScan: number
  candidatesKept: number
  candidatesRejected: number
  tokensIn: number
  tokensOut: number
  skippedReason?: string
}

// scanOnly picked by the task-mining eval sweep (see
// findings/task-mining-benchmark.md): one-shot scan beat two-phase grounding
// on both recall and cost across every model tried.
export const DEFAULT_MINER_CONFIG: TaskMinerConfig = {
  model: PATTERN_DETECTION_CONFIG.MODEL,
  lookbackDays: PATTERN_DETECTION_CONFIG.LOOKBACK_DAYS,
  scanOnly: true,
  clustering: true,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Embedding + linkage surface TaskMiner needs. The in-process
 * EmbeddingService satisfies it (no clusterVectors → linkage runs
 * in-process); the app passes the MlWorkerClient, which has all three so the
 * heavy work stays off the main thread.
 */
export interface MinerEmbedder {
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<number[][]>
  clusterVectors?(vectors: readonly (readonly number[])[], threshold: number): Promise<number[][]>
  scrubBatch?(texts: string[], allow?: string[]): Promise<string[]>
}

/** A discrete task instance proposed by the broad scan. */
export interface Candidate {
  title: string
  /** The specific object this run acted on — defines the instance (one per object). */
  subject: string
  description: string
  /** This run's happy-path steps in "App identity: action" format; [] when omitted. */
  steps: string[]
  activity_ids: string[]
}

export interface MiningRunResult {
  runId: string
  candidatesFromScan: number
  candidatesKept: number
  candidatesRejected: number
  tokenUsage: {
    scan: { input: number; output: number }
    verify: { input: number; output: number }
    total: { input: number; output: number }
  }
  /** Present when the post-mining clustering pass ran. */
  clustering?: ClusteringRunSummary
}

export type ProgressCallback = (message: string) => void

/** Outcome of a one-time multi-day backfill (see TaskMiner.backfill). */
export interface BackfillSummary {
  daysMined: number
  daysSkipped: number
  daysFailed: number
  /** The sweep stopped early and gated the next one. */
  aborted?: boolean
  /** Why it stopped: day failures with no success between them, or a throttling provider. */
  abortReason?: 'failures' | 'rate-limit'
  /** The single clustering pass run after all days are mined. */
  clustering?: ClusteringRunSummary
  /** Set when the backfill did not run at all because a guard tripped. */
  skipped?: 'no-provider' | 'no-model' | 'busy' | 'cooling-down'
}
