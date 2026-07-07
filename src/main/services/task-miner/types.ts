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

/** A discrete task instance proposed by the broad scan. */
export interface Candidate {
  title: string
  /** The specific object this run acted on — defines the instance (one per object). */
  subject: string
  description: string
  apps: string[]
  activity_ids: string[]
}

/** Outcome of grounding a candidate against the real activities. */
export interface GroundedTask {
  verdict: 'keep' | 'reject'
  title: string
  subject?: string
  description: string
  apps: string[]
  activity_ids: string[]
  reason?: string
}

export interface MiningRunResult {
  runId: string
  sightingsFound: number
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
  /** The single clustering pass run after all days are mined. */
  clustering?: ClusteringRunSummary
  /** Set when the backfill did not run at all because a guard tripped. */
  skipped?: 'no-provider' | 'busy'
}
