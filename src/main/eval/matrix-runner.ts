import { estimateCostUsd } from './pricing'
import { scoreDeterministic } from './deterministic'
import type {
  CellAggregate,
  CellCost,
  GoldenReport,
  ReplayActivity,
  RubricScore,
  ScoredSummary,
} from './types'

/**
 * Pure orchestration helpers for the eval matrix (fixtures × models × prompts):
 * per-summary scoring assembly, per-cell aggregation, cost accounting, and a
 * bounded-concurrency runner. The LLM-touching pieces (replay, judge, golden
 * scoring) are injected by the CLI so this module stays unit-testable offline.
 */

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))))
  return sorted[idx]
}

export function buildScoredSummary(params: {
  activity: ReplayActivity
  sessionStartTimestamp: number
  rubric: RubricScore | null
  goldenId: string | null
}): ScoredSummary {
  const { activity, sessionStartTimestamp, rubric, goldenId } = params
  return {
    activityId: activity.activityId,
    appName: activity.appName,
    windowTitle: activity.windowTitle,
    startOffsetMs: activity.startTimestamp - sessionStartTimestamp,
    endOffsetMs: activity.endTimestamp - sessionStartTimestamp,
    durationMs: activity.durationMs,
    summary: activity.summary,
    summaryModel: activity.summaryModel,
    ocrText: activity.ocrText,
    deterministic: scoreDeterministic(activity.summary),
    rubric,
    goldenId,
  }
}

export function aggregateCell(
  summaries: ScoredSummary[],
  golden: GoldenReport | null,
): CellAggregate {
  const count = summaries.length
  const rubricVals = summaries
    .map((s) => s.rubric?.aggregate10)
    .filter((n): n is number => typeof n === 'number')
  const goldenScores = (golden?.matches ?? [])
    .map((m) => m.score)
    .filter((n): n is number => typeof n === 'number')
  const durations = summaries.map((s) => s.durationMs)

  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

  return {
    count,
    avgRubric10: rubricVals.length ? Math.round(mean(rubricVals) * 100) / 100 : null,
    detPassRate: count
      ? Math.round(mean(summaries.map((s) => s.deterministic.passRate)) * 1000) / 1000
      : 0,
    hardFails: summaries.reduce((a, s) => a + s.deterministic.hardFails, 0),
    avgGoldenScore: goldenScores.length ? Math.round(mean(goldenScores) * 1000) / 1000 : null,
    p50DurationMs: percentile(durations, 50),
  }
}

export function computeCellCost(params: {
  activities: ReplayActivity[]
  judgeModel: string | null
  judgeTokensIn: number
  judgeTokensOut: number
}): CellCost {
  let summaryTokensIn = 0
  let summaryTokensOut = 0
  let usd = 0

  // Summary cost: sum every attempt (failed attempts still cost), priced per
  // the model that actually ran — video and snapshot fallbacks may differ.
  for (const a of params.activities) {
    for (const attempt of a.diagnostics?.attempts ?? []) {
      const tin = attempt.promptTokens ?? 0
      const tout = attempt.completionTokens ?? 0
      summaryTokensIn += tin
      summaryTokensOut += tout
      usd += estimateCostUsd(attempt.model, tin, tout)
    }
  }

  if (params.judgeModel) {
    usd += estimateCostUsd(params.judgeModel, params.judgeTokensIn, params.judgeTokensOut)
  }

  return {
    summaryTokensIn,
    summaryTokensOut,
    judgeTokensIn: params.judgeTokensIn,
    judgeTokensOut: params.judgeTokensOut,
    usd: Math.round(usd * 1_000_000) / 1_000_000,
  }
}

/** Runs `fn` over items with at most `limit` in flight; preserves input order. */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workerCount = Math.max(1, Math.min(limit, items.length))

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
