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
  confidence: number
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
  confidence: number | null
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

export interface TaskFixtureScore {
  fixture: string
  model: string
  // keep tasks (recall)
  positiveCount: number
  foundCount: number
  /** foundCount / positiveCount (0 when there are no keep tasks). */
  recall: number
  missedTitles: string[]
  // reject tasks (precision regression)
  negativeCount: number
  rejectedReproducedCount: number
  rejectedReproducedTitles: string[]
  // unlabeled output
  newCount: number
  newSightings: NewSighting[]
  /** Detections that matched 2+ distinct keep tasks (one sighting bundling several). */
  bundledSightingIds: string[]
  avgGroundingRecall: number | null
  avgGroundingPrecision: number | null
  avgConfidence: number | null
  avgEquivalence: number | null
  detectedCount: number
  costUsd: number | null
  judgeCostUsd: number | null
  goldenScores: GoldenSightingScore[]
}

export interface TaskEvalReport {
  generatedAt: string
  vendor: string
  judgeModel: string | null
  fixtures: TaskFixtureScore[]
}

/** Per-golden judge result, keyed by golden title when scoring. */
export interface TaskJudgeScore {
  equivalence: number | null
}
