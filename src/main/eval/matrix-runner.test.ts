import { describe, it, expect } from 'vitest'
import {
  percentile,
  buildScoredSummary,
  aggregateCell,
  computeCellCost,
  runWithConcurrency,
} from './matrix-runner'
import type { ReplayActivity, RubricScore, ScoredSummary } from './types'
import type { SemanticRunDiagnostics as Diag } from '../semantic/types'

function diag(
  attempts: Array<{ model: string; promptTokens: number; completionTokens: number }>,
): Diag {
  return {
    activityId: 'a',
    pipelinePreference: 'auto',
    promptChars: 0,
    chosenMode: 'snapshot',
    chosenModel: attempts[0]?.model ?? null,
    fallbackReason: null,
    attempts: attempts.map((x) => ({
      mode: 'snapshot',
      model: x.model,
      durationMs: 1,
      success: true,
      promptTokens: x.promptTokens,
      completionTokens: x.completionTokens,
    })),
    selectedSnapshotPaths: [],
    videoSizeBytes: null,
    videoMimeType: null,
  }
}

function replayActivity(over: Partial<ReplayActivity> = {}): ReplayActivity {
  return {
    activityId: 'act-1',
    startTimestamp: 1_000_500,
    endTimestamp: 1_010_500,
    durationMs: 10_000,
    appName: 'Code',
    windowTitle: 'auth.ts',
    interactionCount: 3,
    summary:
      'Implemented the token-refresh guard and reviewed the failing expiry test before re-running the suite to confirm the regression cleared across endpoints.',
    summaryModel: 'google/gemini-2.5-flash',
    ocrText: 'auth.ts',
    frameRefs: [],
    selectedSnapshotPaths: [],
    diagnostics: null,
    ...over,
  }
}

function rubric(aggregate10: number): RubricScore {
  return {
    dimensions: [{ key: 'mediaGrounding', score: 4, rationale: '' }],
    aggregate10,
    capped: false,
    flaggedClaims: [],
    judgeModel: 'judge',
    samples: 1,
    tokensIn: 0,
    tokensOut: 0,
  }
}

describe('percentile', () => {
  it('returns the median', () => {
    expect(percentile([10, 20, 30], 50)).toBe(20)
  })
  it('handles empty input', () => {
    expect(percentile([], 50)).toBe(0)
  })
})

describe('buildScoredSummary', () => {
  it('computes session-relative offsets and runs deterministic checks', () => {
    const s = buildScoredSummary({
      activity: replayActivity(),
      sessionStartTimestamp: 1_000_000,
      rubric: rubric(8),
      goldenId: 'g1',
    })
    expect(s.startOffsetMs).toBe(500)
    expect(s.endOffsetMs).toBe(10_500)
    expect(s.goldenId).toBe('g1')
    expect(s.deterministic.hardFails).toBe(0)
    expect(s.rubric?.aggregate10).toBe(8)
  })
})

describe('aggregateCell', () => {
  it('averages rubric/det/golden and counts hard fails', () => {
    const summaries: ScoredSummary[] = [
      buildScoredSummary({
        activity: replayActivity({ activityId: 'a', durationMs: 4000, endTimestamp: 1_004_500 }),
        sessionStartTimestamp: 1_000_000,
        rubric: rubric(8),
        goldenId: null,
      }),
      buildScoredSummary({
        activity: replayActivity({
          activityId: 'b',
          summary: '',
          durationMs: 8000,
          endTimestamp: 1_008_500,
        }),
        sessionStartTimestamp: 1_000_000,
        rubric: rubric(2),
        goldenId: null,
      }),
    ]
    const agg = aggregateCell(summaries, {
      matches: [
        {
          goldenId: 'g1',
          activityId: 'a',
          overlapRatio: 1,
          embedSim: 0.8,
          judgeEquivalence: 0.9,
          score: 0.86,
        },
      ],
      unmatchedGoldenIds: [],
      unmatchedActivityIds: ['b'],
    })
    expect(agg.count).toBe(2)
    expect(agg.avgRubric10).toBe(5) // (8 + 2) / 2
    expect(agg.hardFails).toBe(1) // empty summary 'b'
    expect(agg.avgGoldenScore).toBe(0.86)
    // p50 of [4000, 8000] uses the lower-median (floor index) -> 4000.
    expect(agg.p50DurationMs).toBe(4000)
  })

  it('reports null rubric/golden when none scored', () => {
    const summaries = [
      buildScoredSummary({
        activity: replayActivity(),
        sessionStartTimestamp: 1_000_000,
        rubric: null,
        goldenId: null,
      }),
    ]
    const agg = aggregateCell(summaries, null)
    expect(agg.avgRubric10).toBeNull()
    expect(agg.avgGoldenScore).toBeNull()
  })
})

describe('computeCellCost', () => {
  it('prices summary attempts and judge tokens from the eval pricing map', () => {
    const activities = [
      replayActivity({
        diagnostics: diag([
          {
            model: 'google/gemini-2.5-flash',
            promptTokens: 1_000_000,
            completionTokens: 1_000_000,
          },
        ]),
      }),
    ]
    const cost = computeCellCost({
      activities,
      judgeModel: 'google/gemini-2.5-flash',
      judgeTokensIn: 1_000_000,
      judgeTokensOut: 1_000_000,
    })
    expect(cost.summaryTokensIn).toBe(1_000_000)
    expect(cost.summaryTokensOut).toBe(1_000_000)
    // summary 0.3 + 2.5 = 2.8, judge 0.3 + 2.5 = 2.8 -> 5.6
    expect(cost.usd).toBeCloseTo(5.6, 6)
  })

  it('treats unknown models as $0', () => {
    const activities = [
      replayActivity({
        diagnostics: diag([
          { model: 'mystery/model', promptTokens: 1_000_000, completionTokens: 1_000_000 },
        ]),
      }),
    ]
    const cost = computeCellCost({
      activities,
      judgeModel: null,
      judgeTokensIn: 0,
      judgeTokensOut: 0,
    })
    expect(cost.usd).toBe(0)
    expect(cost.summaryTokensIn).toBe(1_000_000)
  })
})

describe('runWithConcurrency', () => {
  it('preserves order and respects the limit', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const out = await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return n * 10
    })
    expect(out).toEqual([10, 20, 30, 40, 50, 60])
    expect(maxInFlight).toBeLessThanOrEqual(2)
  })
})
