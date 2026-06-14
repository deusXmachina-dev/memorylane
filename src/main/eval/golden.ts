import { cosineSimilarity, generateText } from 'ai'
import log from '../logger'
import type { InferenceProvider } from '../llm'
import { extractJsonObject } from '../services/pattern-detector/helpers'
import type { GoldenEntry, GoldenMatch, GoldenReport } from './types'

/**
 * Goldens are matched to replay activities by time-overlap (ids are
 * nondeterministic across runs), then scored 0.4*embedSim + 0.6*judgeEquivalence.
 * Unmatched goldens or activities are reported as a segmentation-regression
 * signal — e.g. a prompt/model/config change that splits one activity into two
 * leaves a golden unmatched.
 */

export const DEFAULT_MIN_OVERLAP_RATIO = 0.3

export interface MatchableActivity {
  activityId: string
  startTimestamp: number
  endTimestamp: number
  windowTitle?: string
  tld?: string
}

export function matchGoldens(params: {
  activities: MatchableActivity[]
  goldens: GoldenEntry[]
  /** Absolute timestamp the golden offsets are relative to (fixture start). */
  sessionStartTimestamp: number
  minOverlapRatio?: number
}): GoldenReport {
  const minRatio = params.minOverlapRatio ?? DEFAULT_MIN_OVERLAP_RATIO
  const t0 = params.sessionStartTimestamp

  interface Pair {
    goldenId: string
    activityId: string
    ratio: number
    tiebreak: number
  }
  const pairs: Pair[] = []
  for (const g of params.goldens) {
    for (const a of params.activities) {
      const aStart = a.startTimestamp - t0
      const aEnd = a.endTimestamp - t0
      const overlap = Math.max(0, Math.min(aEnd, g.endOffsetMs) - Math.max(aStart, g.startOffsetMs))
      if (overlap <= 0) continue
      const aDur = Math.max(1, aEnd - aStart)
      const gDur = Math.max(1, g.endOffsetMs - g.startOffsetMs)
      const ratio = overlap / Math.min(aDur, gDur)
      if (ratio < minRatio) continue
      let tiebreak = 0
      if (g.windowTitle && a.windowTitle && g.windowTitle === a.windowTitle) tiebreak += 1
      if (g.tld && a.tld && g.tld === a.tld) tiebreak += 1
      pairs.push({ goldenId: g.id, activityId: a.activityId, ratio, tiebreak })
    }
  }

  // Greedy best-match: highest overlap first, window/tld equality breaks ties.
  pairs.sort((x, y) => y.ratio - x.ratio || y.tiebreak - x.tiebreak)
  const usedGoldens = new Set<string>()
  const usedActivities = new Set<string>()
  const matches: GoldenMatch[] = []
  for (const p of pairs) {
    if (usedGoldens.has(p.goldenId) || usedActivities.has(p.activityId)) continue
    usedGoldens.add(p.goldenId)
    usedActivities.add(p.activityId)
    matches.push({
      goldenId: p.goldenId,
      activityId: p.activityId,
      overlapRatio: Math.round(p.ratio * 100) / 100,
      embedSim: null,
      judgeEquivalence: null,
      score: null,
    })
  }

  return {
    matches,
    unmatchedGoldenIds: params.goldens.filter((g) => !usedGoldens.has(g.id)).map((g) => g.id),
    unmatchedActivityIds: params.activities
      .filter((a) => !usedActivities.has(a.activityId))
      .map((a) => a.activityId),
  }
}

export function combineGoldenScore(embedSim: number | null, judge: number | null): number | null {
  if (embedSim !== null && judge !== null)
    return Math.round((0.4 * embedSim + 0.6 * judge) * 1000) / 1000
  if (judge !== null) return judge
  if (embedSim !== null) return embedSim
  return null
}

export interface GoldenEquivalenceResult {
  equivalence: number
  tokensIn: number
  tokensOut: number
}

/** Small judge call: do two summaries describe the same activity? Returns 0..1. */
export async function judgeGoldenEquivalence(params: {
  provider: InferenceProvider
  model: string
  golden: string
  candidate: string
  signal?: AbortSignal
}): Promise<GoldenEquivalenceResult | null> {
  const prompt = [
    'Two summaries describe the same screen-activity session. Rate how equivalent they are in meaning',
    '(do they capture the same work?), 0.0 = unrelated, 1.0 = same substance. Minor wording differences are fine.',
    '',
    `A (reference): ${params.golden}`,
    `B (candidate): ${params.candidate}`,
    '',
    'Respond with ONLY JSON: {"equivalence": <0.0-1.0>}',
  ].join('\n')

  try {
    const result = await generateText({
      model: params.provider.languageModel(params.model),
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      abortSignal: params.signal,
    })
    const parsed = extractJsonObject<{ equivalence?: number }>(result.text)
    if (!parsed || typeof parsed.equivalence !== 'number') return null
    return {
      equivalence: Math.max(0, Math.min(1, parsed.equivalence)),
      tokensIn: result.usage.inputTokens ?? 0,
      tokensOut: result.usage.outputTokens ?? 0,
    }
  } catch (err) {
    log.warn('[golden] equivalence judge failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

export function embedSimilarity(a: number[], b: number[]): number {
  return Math.round(cosineSimilarity(a, b) * 1000) / 1000
}
