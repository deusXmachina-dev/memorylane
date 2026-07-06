import { priceUsd } from './cost'
import type {
  CitedIdCounts,
  DetectedSighting,
  GoldenSighting,
  GoldenSightingScore,
  NewSighting,
  TaskFixture,
  TaskFixtureScore,
  TaskJudgeScore,
} from './task-types'

/**
 * Deterministic scoring for task mining against a LABELED golden (keep/reject).
 * No LLM. For each `keep` task, the detected sighting that best overlaps its
 * activity ids is the match (recall + grounding). Every detection then lands in
 * exactly one bucket:
 *   - found            → explained a found `keep` task
 *   - reject-reproduced → ≥ threshold of a `reject` block (the dumb thing again)
 *   - unreviewed       → ≥ threshold of a `?` block (parked, awaiting a verdict)
 *   - partial-graze    → overlaps some block, best ratio below threshold
 *   - new              → zero overlap with any block → candidate to triage
 * The golden is NOT assumed complete, so a `new` detection is reported, not
 * counted as failure. Cited activity ids are also classified against the labels
 * for id-level precision. The optional judge map adds a semantic-equivalence
 * signal.
 *
 * Pure functions — unit-testable with stub DetectedSighting[] and no network.
 */

const DEFAULT_MATCH_THRESHOLD = 0.5

function countOverlap(ids: Set<string>, target: string[]): number {
  let n = 0
  for (const id of target) if (ids.has(id)) n++
  return n
}

function mean(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/**
 * The detected sighting whose activity ids overlap the golden ids most (>0), or
 * null. Shared by the judge pass (which pair to judge) and scoring (the match
 * itself) so both agree on the same deterministic match.
 */
export function bestDetectedForGolden(
  goldenActivityIds: string[],
  detected: DetectedSighting[],
): { sighting: DetectedSighting; overlap: number } | null {
  let best: DetectedSighting | null = null
  let bestOverlap = 0
  for (const d of detected) {
    const overlap = countOverlap(new Set(d.activityIds), goldenActivityIds)
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      best = d
    }
  }
  return best ? { sighting: best, overlap: bestOverlap } : null
}

/** Best golden block (of the given set) a detection covers, by id-overlap ratio. */
function bestGoldenForDetection(
  d: DetectedSighting,
  goldens: GoldenSighting[],
): { golden: GoldenSighting; ratio: number } | null {
  const ids = new Set(d.activityIds)
  let best: GoldenSighting | null = null
  let bestRatio = 0
  for (const g of goldens) {
    if (g.activityIds.length === 0) continue
    const ratio = countOverlap(ids, g.activityIds) / g.activityIds.length
    if (ratio > bestRatio) {
      bestRatio = ratio
      best = g
    }
  }
  return best ? { golden: best, ratio: bestRatio } : null
}

export interface ScoreParams {
  fixture: TaskFixture
  model: string
  detected: DetectedSighting[]
  tokenUsage: { total: { input: number; output: number } }
  /** Per-golden judge results keyed by golden title (omit for deterministic-only). */
  judge?: Map<string, TaskJudgeScore>
  judgeCostUsd?: number | null
  matchThreshold?: number
  /** Miner mode the run used (recorded on the score for the report). */
  mode?: 'scan-only' | 'two-phase'
}

export function scoreTaskFixture(params: ScoreParams): TaskFixtureScore {
  const threshold = params.matchThreshold ?? DEFAULT_MATCH_THRESHOLD
  const { golden } = params.fixture
  const { detected } = params

  const positives = golden.sightings.filter((s) => s.verdict === 'keep')
  const negatives = golden.sightings.filter((s) => s.verdict === 'reject')
  const unreviewed = golden.sightings.filter((s) => s.verdict === 'unreviewed')
  const matchCount = new Map<string, number>()
  // Detections that explained a found positive — excluded from reject/new buckets.
  const explainedDetIds = new Set<string>()

  const goldenScores: GoldenSightingScore[] = positives.map((g) => {
    const needle = g.activityIds
    const best = bestDetectedForGolden(needle, detected)
    const j = params.judge?.get(g.title)

    if (!best) {
      return {
        goldenTitle: g.title,
        found: false,
        matchedSightingId: null,
        matchedTitle: null,
        grounding: { precision: 0, recall: 0, iou: 0, matchedIds: [] },
        equivalence: j?.equivalence ?? null,
      }
    }

    const ids = new Set(best.sighting.activityIds)
    const matchedIds = needle.filter((id) => ids.has(id))
    const recall = needle.length ? matchedIds.length / needle.length : 0
    const precision = ids.size ? matchedIds.length / ids.size : 0
    const unionSize = new Set([...ids, ...needle]).size
    const iou = unionSize ? matchedIds.length / unionSize : 0
    const meetsMin = g.minActivities ? matchedIds.length >= g.minActivities : true
    const found = recall >= threshold && meetsMin
    if (found) {
      matchCount.set(best.sighting.id, (matchCount.get(best.sighting.id) ?? 0) + 1)
      explainedDetIds.add(best.sighting.id)
    }

    return {
      goldenTitle: g.title,
      found,
      matchedSightingId: best.sighting.id,
      matchedTitle: best.sighting.title,
      grounding: { precision, recall, iou, matchedIds },
      equivalence: j?.equivalence ?? null,
    }
  })

  // Bucket every other detection: reject-reproduced, unreviewed, new (zero
  // overlap with any block), or partial-graze (the leftover).
  const rejectedReproducedTitles = new Set<string>()
  const newSightings: NewSighting[] = []
  let rejectsReproducedCount = 0
  let unreviewedMatchedCount = 0
  let partialGrazeCount = 0
  for (const d of detected) {
    if (explainedDetIds.has(d.id)) continue
    const negMatch = bestGoldenForDetection(d, negatives)
    if (negMatch && negMatch.ratio >= threshold) {
      rejectedReproducedTitles.add(negMatch.golden.title)
      rejectsReproducedCount++
      continue
    }
    const unrevMatch = bestGoldenForDetection(d, unreviewed)
    if (unrevMatch && unrevMatch.ratio >= threshold) {
      unreviewedMatchedCount++
      continue
    }
    const anyMatch = bestGoldenForDetection(d, golden.sightings)
    if (!anyMatch || anyMatch.ratio === 0) {
      newSightings.push({
        id: d.id,
        title: d.title,
        description: d.description,
        apps: d.apps,
        activityIds: d.activityIds,
      })
    } else {
      partialGrazeCount++
    }
  }

  // Id-level precision: every cited id, classified against the labels
  // (unreviewed-block ids stay unlabeled).
  const keepIds = new Set(positives.flatMap((g) => g.activityIds))
  const rejectIds = new Set(negatives.flatMap((g) => g.activityIds))
  const citedIds: CitedIdCounts = { inKeep: 0, inReject: 0, unlabeled: 0, total: 0 }
  for (const d of detected) {
    for (const id of new Set(d.activityIds)) {
      citedIds.total++
      if (keepIds.has(id)) citedIds.inKeep++
      else if (rejectIds.has(id)) citedIds.inReject++
      else citedIds.unlabeled++
    }
  }

  const bundledSightingIds = [...matchCount.entries()].filter(([, n]) => n > 1).map(([id]) => id)
  const found = goldenScores.filter((s) => s.found)

  return {
    fixture: params.fixture.manifest.name,
    model: params.model,
    mode: params.mode,
    positiveCount: positives.length,
    foundCount: found.length,
    recall: positives.length ? found.length / positives.length : 0,
    missedTitles: goldenScores.filter((s) => !s.found).map((s) => s.goldenTitle),
    negativeCount: negatives.length,
    rejectedReproducedCount: rejectedReproducedTitles.size,
    rejectedReproducedTitles: [...rejectedReproducedTitles],
    foundDetectionsCount: explainedDetIds.size,
    rejectsReproducedCount,
    unreviewedMatchedCount,
    partialGrazeCount,
    newCount: newSightings.length,
    newSightings,
    citedIds,
    idPrecision: citedIds.total ? citedIds.inKeep / citedIds.total : null,
    bundledSightingIds,
    avgGroundingRecall: mean(found.map((s) => s.grounding.recall)),
    avgGroundingPrecision: mean(found.map((s) => s.grounding.precision)),
    avgEquivalence: mean(found.map((s) => s.equivalence)),
    detectedCount: detected.length,
    costUsd: priceUsd(params.model, params.tokenUsage.total.input, params.tokenUsage.total.output),
    judgeCostUsd: params.judgeCostUsd ?? null,
    goldenScores,
  }
}
