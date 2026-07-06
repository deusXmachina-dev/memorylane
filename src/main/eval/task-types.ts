/**
 * Types for the task-mining eval system.
 *
 * A fixture is a whole real day exported from the dev DB (every activity —
 * realistic volume, since the production miner scans an entire day in one pass).
 * The golden is built by LABELING the miner's own output: run it, then thumbs
 * each sighting `keep` (a legit task) or `reject` (stupid). The harness re-runs
 * the REAL miner and scores its output against those labels:
 *   - found   — reproduced a `keep` task (recall over what you've labeled good)
 *   - rejected-reproduced — reproduced a `reject` (the miner doing the dumb thing)
 *   - unreviewed / partial-graze — hit a `?` block, or grazed a block below threshold
 *   - new     — matched no label yet → triage it (thumbs it next time)
 *
 * The golden is NOT assumed complete: a `new` sighting is a candidate to review,
 * not a failure. (Consequence: recall is only over labeled-good tasks — this
 * loop can't see tasks the miner never surfaced.)
 *
 * Mirrors the activity-summary eval (`types.ts`); the input here is a seeded DB
 * rather than replayed frames, because `runDetection` reads activities from
 * StorageService.
 */

export const TASK_FIXTURE_SCHEMA_VERSION = 3

// ---------------------------------------------------------------------------
// Fixture inputs (on disk)
// ---------------------------------------------------------------------------

/**
 * One activity in the exported day. Timestamps are derived at load time from
 * `offsetMin` (minutes from the target day's start) + `durationMin`, so every
 * row lands inside the window the miner queries regardless of when the eval runs.
 */
export interface TaskFixtureActivity {
  id: string
  offsetMin: number
  durationMin: number
  app: string
  windowTitle: string
  tld: string | null
  summary: string
  ocrText: string
}

/** keep = a legit task; reject = a bad grouping; unreviewed = parked, awaiting your call. */
export type GoldenVerdict = 'keep' | 'reject' | 'unreviewed'

/** A labeled sighting in golden.md. */
export interface GoldenSighting {
  title: string
  description: string
  apps: string[]
  /** IDs of the day's activities that make up this sighting. */
  activityIds: string[]
  verdict: GoldenVerdict
  /** Minimum activity ids a detection must cover to count as matching this. */
  minActivities?: number
}

export interface TaskGolden {
  /** All labeled blocks (keep/reject/unreviewed). Scoring uses keep + reject. */
  sightings: GoldenSighting[]
  notes?: string
}

export interface TaskFixtureManifest {
  name: string
  label: string
  description: string
  /** Total activities in the exported day. */
  activityCount: number
  /** Source day the activities were exported from (YYYY-MM-DD), for provenance. */
  sourceDay?: string
  schemaVersion: number
}

export interface TaskFixture {
  dir: string
  manifest: TaskFixtureManifest
  /** The whole day, sorted by offset. */
  activities: TaskFixtureActivity[]
  golden: TaskGolden
}

// ---------------------------------------------------------------------------
// Miner output (collected after a run)
// ---------------------------------------------------------------------------

export interface DetectedSighting {
  id: string
  title: string
  description: string
  apps: string[]
  activityIds: string[]
  interactionMin: number
}

export interface TaskRunResult {
  detected: DetectedSighting[]
  tokenUsage: {
    scan: { input: number; output: number }
    verify: { input: number; output: number }
    total: { input: number; output: number }
  }
  candidatesFromScan: number
  candidatesKept: number
  candidatesRejected: number
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Activity-id overlap between the matched detected sighting and the golden block. */
export interface Grounding {
  precision: number
  recall: number
  iou: number
  matchedIds: string[]
}

/** Result of scoring one `keep` golden against its best-matching detection. */
export interface GoldenSightingScore {
  goldenTitle: string
  found: boolean
  matchedSightingId: string | null
  matchedTitle: string | null
  grounding: Grounding
  /** LLM-judge: 0..1 semantic equivalence with the golden (null if no judge). */
  equivalence: number | null
}

/** A detected sighting matching no golden block — a candidate to thumbs next. */
export interface NewSighting {
  id: string
  title: string
  description: string
  apps: string[]
  activityIds: string[]
}

/** Activity ids cited across all detections, classified against the golden labels. */
export interface CitedIdCounts {
  inKeep: number
  inReject: number
  /** Not in any keep/reject block — includes ids in unreviewed (`?`) blocks. */
  unlabeled: number
  total: number
}

export interface TaskFixtureScore {
  fixture: string
  model: string
  /** Miner mode: 'scan-only' (default; no Phase 2 grounding) or 'two-phase'. */
  mode?: 'scan-only' | 'two-phase'
  // keep tasks (recall)
  positiveCount: number
  foundCount: number
  /** foundCount / positiveCount (0 when there are no keep tasks). */
  recall: number
  missedTitles: string[]
  // reject tasks (precision regression)
  negativeCount: number
  /** Distinct reject blocks reproduced (title-level). */
  rejectedReproducedCount: number
  rejectedReproducedTitles: string[]
  // Per-detection buckets — every detection lands in exactly one; the five
  // counts (foundDetections/rejectsReproduced/unreviewedMatched/partialGraze/new)
  // sum to detectedCount.
  /** Detections that explained a found keep task. */
  foundDetectionsCount: number
  /** Detections covering ≥ threshold of a reject block (counts each detection). */
  rejectsReproducedCount: number
  /** Detections covering ≥ threshold of an unreviewed (`?`) block. */
  unreviewedMatchedCount: number
  /** Detections whose best golden overlap is partial and below threshold. */
  partialGrazeCount: number
  // unlabeled output (zero overlap with any golden block)
  newCount: number
  newSightings: NewSighting[]
  // id-level precision over every cited activity id
  citedIds: CitedIdCounts
  /** citedIds.inKeep / citedIds.total (null with no cited ids). */
  idPrecision: number | null
  /** Detections that matched 2+ distinct keep tasks (one sighting bundling several). */
  bundledSightingIds: string[]
  avgGroundingRecall: number | null
  avgGroundingPrecision: number | null
  avgEquivalence: number | null
  detectedCount: number
  costUsd: number | null
  judgeCostUsd: number | null
  goldenScores: GoldenSightingScore[]
}

/** A fixture × model run that threw and produced no score. */
export interface TaskRunFailure {
  fixture: string
  model: string
  mode: 'scan-only' | 'two-phase'
  error: string
}

export interface TaskEvalReport {
  generatedAt: string
  vendor: string
  judgeModel: string | null
  fixtures: TaskFixtureScore[]
  /** Absent in reports written before failures were recorded. */
  failures?: TaskRunFailure[]
}

/** Per-golden judge result, keyed by golden title when scoring. */
export interface TaskJudgeScore {
  equivalence: number | null
}
