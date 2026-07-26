import type { SemanticRunDiagnostics } from '../semantic/types'
import type { DroppedActivityReason } from '@main/activity/activity-types'
import type { ActivityProducerStats } from '@main/activity/activity-producer'

/**
 * Shared types for the activity-summary eval & replay system.
 *
 * Pipeline: a captured session (frames + event windows) is promoted into a
 * committed fixture, replayed through the real ActivityProducer + summarizer to
 * produce ReplayActivity[], then scored (deterministic rule checks + an optional
 * LLM golden-equivalence judge) into a Markdown scorecard.
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

/**
 * One activity as the *live* pipeline summarized it during an in-app recording,
 * tapped off the extractor and written to the staging `activities.jsonl`. The
 * recorder dumps these so a fixture's golden can be seeded from the real
 * summaries produced at capture time — no replay, no DB join. `dumpedAt`/`lagMs`
 * are stamped by the dumper.
 */
export interface DumpedActivity {
  id: string
  startTimestamp: number
  endTimestamp: number
  appName: string
  windowTitle: string
  tld?: string
  summary: string
  summaryModel: string
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
  /**
   * Set when this entry is a window/activity the producer *dropped* (never
   * emitted). Such entries carry no summary; they exist so the golden transcript
   * can render a `DROPPED` block. Absent for normally-emitted activities.
   */
  dropped?: { reason: DroppedActivityReason; detail: string }
}

// --------------------------------------------------------------------------
// Scoring
// --------------------------------------------------------------------------

export interface DeterministicCheck {
  id: string
  passed: boolean
  /** 'hard' failures are unambiguous rule violations; 'soft' are warnings. */
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

/** A summary's match against its golden block (segmentation + equivalence). */
export interface GoldenMatch {
  /** 1-based golden block index. */
  index: number
  /** The hand-authored target summary. */
  summary: string
  overlapRatio: number
  /** 0..1 equivalence of candidate vs golden, or null when the judge is off. */
  equivalence: number | null
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
  /** Present when the fixture has a golden.md and this activity matched a block. */
  golden: GoldenMatch | null
  /** Summarizer (production) token usage for this activity, summed over attempts. */
  summaryTokensIn: number
  summaryTokensOut: number
  /** Summarizer cost in USD, or null when the model isn't in the pricing table. */
  summaryCostUsd: number | null
  /** Eval-time equivalence-judge cost in USD, or null when unpriced. */
  judgeCostUsd: number | null
}

/** How a replay's segmentation lined up with the golden.md blocks. */
export interface SegmentationScore {
  /** Golden blocks expecting a kept activity (excludes DROPPED blocks). */
  goldenCount: number
  /** matched / goldenCount over the kept blocks, 0..1. */
  coverage: number
  /** Kept golden blocks with no produced activity (merged/missed boundary). */
  unmatchedGoldenIndexes: number[]
  /** Produced activities with no golden block (over-split). */
  extraActivityCount: number
  /** Golden blocks marked DROPPED (the pipeline is expected to discard them). */
  expectedDropCount: number
  /**
   * DROPPED golden blocks that a produced activity overlapped anyway — the
   * pipeline kept/summarized where the target says it should drop. A violation.
   */
  dropViolationIndexes: number[]
}

/**
 * Re-exported from the producer so the eval report can't drift from the real
 * stats shape: a field added/renamed there is picked up here automatically.
 */
export type ProducerStats = ActivityProducerStats

/** All scored summaries for one (fixture × model) run. */
export interface FixtureScore {
  fixture: string
  model: string
  summaries: ScoredSummary[]
  producerStats: ProducerStats
  /** Mean deterministic pass rate, 0..1. */
  detPassRate: number
  hardFails: number
  /** Segmentation vs golden.md, or null when the fixture has no golden. */
  segmentation: SegmentationScore | null
  /** Mean golden equivalence over matched blocks, 0..1, or null. */
  avgEquivalence: number | null
  /** Total summarizer (production) cost in USD over all activities, or null if unpriced. */
  costUsd: number | null
  /** Total eval-time equivalence-judge cost in USD, or null if unpriced. */
  judgeCostUsd: number | null
}

export interface EvalReport {
  generatedAt: string
  vendor: string
  judgeModel: string | null
  fixtures: FixtureScore[]
}
