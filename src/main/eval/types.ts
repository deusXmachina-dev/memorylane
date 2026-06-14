import type { SemanticPipelinePreference, SemanticRunDiagnostics } from '../semantic/types'

/**
 * Shared types for the activity-summary eval & replay system.
 *
 * Pipeline: a captured session (frames + event windows) is promoted into a
 * committed fixture, replayed through the real ActivityProducer + summarizer to
 * produce ReplayActivity[], then scored (deterministic checks + LLM judge +
 * golden references) into a comparable scorecard.
 */

export const FIXTURE_SCHEMA_VERSION = 1

/** Synthesized when a debug-pipeline run is promoted into a fixture. */
export interface FixtureManifest {
  name: string
  label: string
  description: string
  /** ISO timestamp the fixture was promoted. */
  capturedAt: string
  platform: NodeJS.Platform | string
  /** Distinct app names seen across the event windows. */
  appMix: string[]
  frameCount: number
  eventWindowCount: number
  /** Optional hand-noted expectation, used as a segmentation sanity check. */
  expectedActivityCount?: number
  /** True when PNGs were re-encoded smaller during promotion. */
  downsampled?: boolean
  schemaVersion: number
}

/** One frame record as stored in a fixture/debug `frames.jsonl`. */
export interface DumpedFrame {
  filepath: string
  timestamp: number
  width: number
  height: number
  displayId: number
  sequenceNumber: number
  dumpedAt?: number
  lagMs?: number
}

/** One activity produced by replaying a fixture through the real pipeline. */
export interface ReplayActivity {
  activityId: string
  startTimestamp: number
  endTimestamp: number
  durationMs: number
  appName: string
  windowTitle: string
  tld?: string
  interactionCount: number
  summary: string
  /** '' for LLM output, 'heuristic:viewed' for the passive path, or a model id. */
  summaryModel: string
  ocrText: string
  /** Absolute paths to every frame in the activity. */
  frameRefs: string[]
  /** Frames the snapshot summarizer actually saw (empty for the video path). */
  selectedSnapshotPaths: string[]
  diagnostics: SemanticRunDiagnostics | null
}

/** Replay output for one (fixture × model × prompt) cell. */
export interface ReplayResult {
  fixture: string
  /** Requested video model id (or '' when video disabled). */
  videoModel: string
  /** Requested snapshot model id. */
  snapshotModel: string
  promptVariant: string
  pipeline: SemanticPipelinePreference
  activities: ReplayActivity[]
  producerStats: {
    emittedActivities: number
    droppedNoFrameWindows: number
    droppedUnknownContextWindows: number
    trailingFramesTrimmed: number
  }
  /** ISO timestamp, stamped by the CLI after the run. */
  generatedAt?: string
}

// --------------------------------------------------------------------------
// Scoring
// --------------------------------------------------------------------------

export interface DeterministicCheck {
  id: string
  passed: boolean
  /** 'hard' failures cap quality; 'soft' are warnings only. */
  severity: 'hard' | 'soft'
  detail?: string
}

export interface DeterministicResult {
  checks: DeterministicCheck[]
  hardFails: number
  softWarns: number
  /** Fraction of checks passed, 0..1. */
  passRate: number
}

export interface RubricDimension {
  key: string
  /** 0..5 */
  score: number
  rationale: string
}

export interface RubricScore {
  dimensions: RubricDimension[]
  /** Weighted aggregate, 0..10, after the hard cap. */
  aggregate10: number
  /** True when the hard cap (hallucination/noRawInteractions <= 2) was applied. */
  capped: boolean
  flaggedClaims: string[]
  judgeModel: string
  /** Number of judge samples averaged into this score. */
  samples: number
  tokensIn: number
  tokensOut: number
}

export interface GoldenEntry {
  id: string
  appName: string
  /** Session-relative match window, ms from fixture start. */
  startOffsetMs: number
  endOffsetMs: number
  windowTitle?: string
  tld?: string
  /** The hand-authored ideal summary. */
  summary: string
}

export interface GoldenMatch {
  goldenId: string
  activityId: string | null
  overlapRatio: number
  embedSim: number | null
  judgeEquivalence: number | null
  /** 0.4*embedSim + 0.6*judgeEquivalence, or null when not scored. */
  score: number | null
}

export interface GoldenReport {
  matches: GoldenMatch[]
  unmatchedGoldenIds: string[]
  unmatchedActivityIds: string[]
}

export interface ScoredSummary {
  activityId: string
  appName: string
  windowTitle: string
  startOffsetMs: number
  endOffsetMs: number
  durationMs: number
  summary: string
  summaryModel: string
  ocrText: string
  deterministic: DeterministicResult
  rubric: RubricScore | null
  goldenId: string | null
}

export interface CellCost {
  summaryTokensIn: number
  summaryTokensOut: number
  judgeTokensIn: number
  judgeTokensOut: number
  usd: number
}

export interface CellAggregate {
  count: number
  avgRubric10: number | null
  detPassRate: number
  hardFails: number
  avgGoldenScore: number | null
  p50DurationMs: number
}

export interface CellResult {
  fixture: string
  videoModel: string
  snapshotModel: string
  promptVariant: string
  pipeline: SemanticPipelinePreference
  summaries: ScoredSummary[]
  golden: GoldenReport | null
  cost: CellCost
  aggregate: CellAggregate
  producerStats: ReplayResult['producerStats']
}

export interface EvalRun {
  runId: string
  generatedAt: string
  vendor: string
  judgeModel: string | null
  judgeTextOnly: boolean
  cells: CellResult[]
  baselineRunId: string | null
}
