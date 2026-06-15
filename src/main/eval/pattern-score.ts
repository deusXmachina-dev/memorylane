import { priceUsd } from './cost'
import type {
  DetectedPattern,
  GoldenMatchScore,
  PatternFixture,
  PatternFixtureScore,
  PatternJudgeScore,
} from './pattern-types'

/**
 * Deterministic scoring for pattern detection. No LLM: matches each golden
 * pattern to the detected pattern that best overlaps its tagged needle
 * activities, then grades grounding (precision/recall/IoU of activity ids) and
 * counts spurious detections (patterns overlapping no needle). The optional
 * judge map adds semantic-equivalence + automation-quality signals.
 *
 * Pure functions — unit-testable with stub DetectedPattern[] and no network.
 */

const DEFAULT_RECALL_THRESHOLD = 0.5

function unionActivityIds(p: DetectedPattern): Set<string> {
  const s = new Set<string>()
  for (const sighting of p.sightings) for (const id of sighting.activityIds) s.add(id)
  return s
}

function countOverlap(ids: Set<string>, needle: string[]): number {
  let n = 0
  for (const id of needle) if (ids.has(id)) n++
  return n
}

function mean(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/**
 * The detected pattern whose activity ids overlap the needle most (>0), or null.
 * Shared by the judge pass (which pair to judge) and scoring (the match itself)
 * so both agree on the same deterministic match.
 */
export function bestDetectedForGolden(
  needleActivityIds: string[],
  detected: DetectedPattern[],
): { pattern: DetectedPattern; overlap: number } | null {
  let best: DetectedPattern | null = null
  let bestOverlap = 0
  for (const d of detected) {
    const overlap = countOverlap(unionActivityIds(d), needleActivityIds)
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      best = d
    }
  }
  return best ? { pattern: best, overlap: bestOverlap } : null
}

export interface ScoreParams {
  fixture: PatternFixture
  model: string
  detected: DetectedPattern[]
  tokenUsage: { total: { input: number; output: number } }
  /** Per-golden judge results keyed by golden id (omit for deterministic-only). */
  judge?: Map<string, PatternJudgeScore>
  judgeCostUsd?: number | null
  recallThreshold?: number
}

export function scorePatternFixture(params: ScoreParams): PatternFixtureScore {
  const recallThreshold = params.recallThreshold ?? DEFAULT_RECALL_THRESHOLD
  const { golden } = params.fixture
  const { detected } = params

  const goldenScores: GoldenMatchScore[] = golden.patterns.map((g) => {
    const needle = g.needleActivityIds
    const best = bestDetectedForGolden(needle, detected)

    if (!best) {
      const j = params.judge?.get(g.id)
      return {
        goldenId: g.id,
        goldenName: g.name,
        found: false,
        matchedPatternId: null,
        matchedPatternName: null,
        grounding: { precision: 0, recall: 0, iou: 0, matchedIds: [] },
        sightingCount: 0,
        avgConfidence: null,
        equivalence: j?.equivalence ?? null,
        automationQuality: j?.automationQuality ?? null,
        automationNotes: j?.automationNotes ?? null,
      }
    }

    const ids = unionActivityIds(best.pattern)
    const matchedIds = needle.filter((id) => ids.has(id))
    const recall = needle.length ? matchedIds.length / needle.length : 0
    const precision = ids.size ? matchedIds.length / ids.size : 0
    const unionSize = new Set([...ids, ...needle]).size
    const iou = unionSize ? matchedIds.length / unionSize : 0
    const confs = best.pattern.sightings.map((s) => s.confidence)
    const avgConfidence = mean(confs)
    const meetsSightings = g.minSightings ? best.pattern.sightingCount >= g.minSightings : true
    const found = recall >= recallThreshold && meetsSightings
    const j = params.judge?.get(g.id)

    return {
      goldenId: g.id,
      goldenName: g.name,
      found,
      matchedPatternId: best.pattern.id,
      matchedPatternName: best.pattern.name,
      grounding: { precision, recall, iou, matchedIds },
      sightingCount: best.pattern.sightingCount,
      avgConfidence,
      equivalence: j?.equivalence ?? null,
      automationQuality: j?.automationQuality ?? null,
      automationNotes: j?.automationNotes ?? null,
    }
  })

  // Spurious = detected patterns overlapping NO golden needle and not whitelisted.
  // (A weak match that overlaps a needle but fell short of `found` is a partial
  // detection, not a false positive — so it is excluded here.)
  const acceptable = (golden.acceptableExtraPatterns ?? []).map((s) => s.toLowerCase())
  const spuriousNames: string[] = []
  for (const d of detected) {
    const ids = unionActivityIds(d)
    const overlapsAnyNeedle = golden.patterns.some(
      (g) => countOverlap(ids, g.needleActivityIds) > 0,
    )
    if (overlapsAnyNeedle) continue
    const name = d.name.toLowerCase()
    if (acceptable.some((a) => name.includes(a) || a.includes(name))) continue
    spuriousNames.push(d.name)
  }

  const found = goldenScores.filter((s) => s.found)
  const goldenCount = golden.patterns.length

  return {
    fixture: params.fixture.manifest.name,
    model: params.model,
    goldenCount,
    foundCount: found.length,
    recall: goldenCount ? found.length / goldenCount : 0,
    avgGroundingRecall: mean(found.map((s) => s.grounding.recall)),
    spuriousCount: spuriousNames.length,
    spuriousNames,
    avgConfidence: mean(found.map((s) => s.avgConfidence)),
    avgEquivalence: mean(found.map((s) => s.equivalence)),
    avgAutomationQuality: mean(found.map((s) => s.automationQuality)),
    detectedCount: detected.length,
    costUsd: priceUsd(params.model, params.tokenUsage.total.input, params.tokenUsage.total.output),
    judgeCostUsd: params.judgeCostUsd ?? null,
    goldenScores,
  }
}
