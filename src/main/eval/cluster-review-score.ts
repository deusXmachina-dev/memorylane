/**
 * Known-answer eval for the cluster-review LLM call — the judgment that
 * classifies clusters (procedure/monitoring/ambient/dev-loop/judgment) and
 * consolidates the elimination mechanism. Fixtures are canned ReviewInput
 * payloads (exactly what production sends) plus expected outcomes; scoring is
 * fully deterministic. The headline metric is the FALSE-ELIMINABLE RATE:
 * clusters promised as automatable procedures that a human judged otherwise —
 * the number that must be ~0 before `kind` may gate or roll up anything.
 */

import type { ClusterKind } from '@types'
import type { ReviewInput, ReviewOutput } from '@main/services/task-miner/clustering/types'
import { sanitizeVerdict } from '@main/services/task-miner/clustering/apply-review'

export interface ClusterReviewFixture {
  name: string
  description?: string
  /** Exactly what production sends to the review call. */
  input: ReviewInput
  expected: {
    /** Expected kind per reviewed cluster id. */
    verdicts: Record<string, { kind: Exclude<ClusterKind, ''> }>
  }
}

export interface ClusterReviewScore {
  fixture: string
  model: string
  /** Expected-verdict clusters judged (denominator for accuracy). */
  verdictCount: number
  kindCorrect: number
  /** Expected non-procedure, predicted procedure (post-sanitize) — the headline. */
  falseEliminable: number
  /** Expected procedure, predicted anything else (incl. unclassified). */
  missedProcedure: number
  /** Predicted '' (off-enum, omitted, or procedure-without-mechanism). */
  unclassified: number
  perKind: Record<string, { total: number; correct: number; asProcedure: number }>
  tokenUsage: { input: number; output: number }
}

export function scoreClusterReview(args: {
  fixture: ClusterReviewFixture
  model: string
  output: ReviewOutput
  tokenUsage: { input: number; output: number }
}): ClusterReviewScore {
  const { fixture, model, output, tokenUsage } = args
  const expected = fixture.expected

  const verdictById = new Map((output.clusters ?? []).map((c) => [c.id, c]))
  const splitIds = new Set(
    (output.clusters ?? []).filter((c) => (c.split?.length ?? 0) >= 2).map((c) => c.id),
  )

  const score: ClusterReviewScore = {
    fixture: fixture.name,
    model,
    verdictCount: 0,
    kindCorrect: 0,
    falseEliminable: 0,
    missedProcedure: 0,
    unclassified: 0,
    perKind: {},
    tokenUsage,
  }

  for (const [clusterId, exp] of Object.entries(expected.verdicts)) {
    score.verdictCount++
    const raw = verdictById.get(clusterId)
    // A split instead of a verdict, or no verdict at all, counts as unclassified.
    const predicted =
      raw && !splitIds.has(clusterId) ? sanitizeVerdict(raw) : { kind: '' as const, mechanism: '' }

    const bucket = (score.perKind[exp.kind] ??= { total: 0, correct: 0, asProcedure: 0 })
    bucket.total++
    if (predicted.kind === '') score.unclassified++
    if (predicted.kind === exp.kind) {
      score.kindCorrect++
      bucket.correct++
    }
    if (predicted.kind === 'procedure') {
      bucket.asProcedure++
      if (exp.kind !== 'procedure') score.falseEliminable++
    } else if (exp.kind === 'procedure') {
      score.missedProcedure++
    }
  }

  return score
}

export function aggregateClusterReviewScores(scores: ClusterReviewScore[]): {
  verdictCount: number
  kindCorrect: number
  falseEliminable: number
  falseEliminableRate: number | null
  missedProcedure: number
  unclassified: number
  perKind: Record<string, { total: number; correct: number; asProcedure: number }>
} {
  const perKind: Record<string, { total: number; correct: number; asProcedure: number }> = {}
  let verdictCount = 0
  let kindCorrect = 0
  let falseEliminable = 0
  let missedProcedure = 0
  let unclassified = 0
  let nonProcedureTotal = 0
  for (const s of scores) {
    verdictCount += s.verdictCount
    kindCorrect += s.kindCorrect
    falseEliminable += s.falseEliminable
    missedProcedure += s.missedProcedure
    unclassified += s.unclassified
    for (const [kind, b] of Object.entries(s.perKind)) {
      const agg = (perKind[kind] ??= { total: 0, correct: 0, asProcedure: 0 })
      agg.total += b.total
      agg.correct += b.correct
      agg.asProcedure += b.asProcedure
      if (kind !== 'procedure') nonProcedureTotal += b.total
    }
  }
  return {
    verdictCount,
    kindCorrect,
    falseEliminable,
    falseEliminableRate: nonProcedureTotal > 0 ? falseEliminable / nonProcedureTotal : null,
    missedProcedure,
    unclassified,
    perKind,
  }
}
