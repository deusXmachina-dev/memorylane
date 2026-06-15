/**
 * Types for the pattern-detection (task-mining) eval system.
 *
 * A fixture is a hand-authored day of activities (mostly noise) with a real
 * automatable pattern deliberately hidden inside it (the "needle"). The harness
 * seeds those activities into a temp DB, runs the REAL detector, and scores
 * whether it found the needle — without spurious noise — across models/prompts.
 *
 * Mirrors the activity-summary eval (`types.ts`); the input here is a seeded DB
 * rather than replayed frames, because `runDetection` reads activities from
 * StorageService.
 */

export const PATTERN_FIXTURE_SCHEMA_VERSION = 1

// ---------------------------------------------------------------------------
// Fixture inputs (on disk)
// ---------------------------------------------------------------------------

/**
 * One authored activity. Timestamps are derived at load time from `offsetMin`
 * (minutes from the target day's start) + `durationMin`, so every row lands
 * inside the queried day window regardless of when the eval runs.
 */
export interface FixtureActivity {
  id: string
  offsetMin: number
  durationMin: number
  app: string
  windowTitle: string
  tld: string | null
  summary: string
  ocrText: string
}

/** A pattern the detector SHOULD surface, with its needle activities tagged. */
export interface GoldenPattern {
  id: string
  name: string
  description: string
  apps: string[]
  automationIdea: string
  /** IDs of the fixture activities that constitute this pattern. */
  needleActivityIds: string[]
  /** Minimum sightings the detected pattern must have to count as "found". */
  minSightings?: number
}

export interface PatternGolden {
  patterns: GoldenPattern[]
  /**
   * Names of known-OK extra patterns that should NOT count as false positives
   * (substring match against detected names, case-insensitive).
   */
  acceptableExtraPatterns?: string[]
  notes?: string
}

export interface PatternFixtureManifest {
  name: string
  label: string
  description: string
  activityCount: number
  needlePatternCount: number
  schemaVersion: number
}

export interface PatternFixture {
  dir: string
  manifest: PatternFixtureManifest
  activities: FixtureActivity[]
  golden: PatternGolden
}

// ---------------------------------------------------------------------------
// Detector output (collected after a run)
// ---------------------------------------------------------------------------

export interface DetectedSighting {
  activityIds: string[]
  confidence: number
  evidence: string
  durationEstimateMin: number | null
}

export interface DetectedPattern {
  id: string
  name: string
  description: string
  apps: string[]
  automationIdea: string
  sightingCount: number
  sightings: DetectedSighting[]
}

export interface PatternRunResult {
  detected: DetectedPattern[]
  tokenUsage: {
    scan: { input: number; output: number }
    verify: { input: number; output: number }
    total: { input: number; output: number }
  }
  candidatesFromScan: number
  candidatesVerified: number
  candidatesRejected: number
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Activity-id overlap between the matched detected pattern and the needle. */
export interface Grounding {
  precision: number
  recall: number
  iou: number
  matchedIds: string[]
}

/** Result of judging one golden pattern against its best-matching detection. */
export interface GoldenMatchScore {
  goldenId: string
  goldenName: string
  found: boolean
  matchedPatternId: string | null
  matchedPatternName: string | null
  grounding: Grounding
  sightingCount: number
  avgConfidence: number | null
  /** LLM-judge: 0..1 semantic equivalence with the golden (null if no judge). */
  equivalence: number | null
  /** LLM-judge: 0..10 automation-idea quality (null if no judge). */
  automationQuality: number | null
  automationNotes: string | null
}

export interface PatternFixtureScore {
  fixture: string
  model: string
  goldenCount: number
  foundCount: number
  /** foundCount / goldenCount (0 when there are no goldens). */
  recall: number
  avgGroundingRecall: number | null
  /** Detected patterns overlapping no needle and not whitelisted. */
  spuriousCount: number
  spuriousNames: string[]
  avgConfidence: number | null
  avgEquivalence: number | null
  avgAutomationQuality: number | null
  detectedCount: number
  costUsd: number | null
  judgeCostUsd: number | null
  goldenScores: GoldenMatchScore[]
}

export interface PatternEvalReport {
  generatedAt: string
  vendor: string
  judgeModel: string | null
  fixtures: PatternFixtureScore[]
}

/** Per-golden judge result, keyed by golden id when scoring. */
export interface PatternJudgeScore {
  equivalence: number | null
  automationQuality: number | null
  automationNotes: string | null
}
