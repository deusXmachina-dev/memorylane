import { PATTERN_DETECTION_CONFIG } from '../../../shared/constants'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface TaskMinerConfig {
  model: string
  lookbackDays: number
  /** Skip Phase 2 (per-candidate tool-equipped grounding); scan output is final. */
  scanOnly: boolean
}

// Model + mode picked by the task-mining eval sweep (see
// findings/task-mining-benchmark.md): one-shot scan beat two-phase grounding
// on both recall and cost across every model tried. Deliberately NOT
// PATTERN_DETECTION_CONFIG.MODEL — that default still serves the legacy
// pattern detector, where minimax-m3 is unevaluated.
export const DEFAULT_MINER_CONFIG: TaskMinerConfig = {
  model: 'minimax/minimax-m3',
  lookbackDays: PATTERN_DETECTION_CONFIG.LOOKBACK_DAYS,
  scanOnly: true,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A discrete task instance proposed by the broad scan. */
export interface Candidate {
  title: string
  description: string
  apps: string[]
  activity_ids: string[]
}

/** Outcome of grounding a candidate against the real activities. */
export interface GroundedTask {
  verdict: 'keep' | 'reject'
  title: string
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
}

export type ProgressCallback = (message: string) => void
