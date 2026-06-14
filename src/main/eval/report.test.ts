import { describe, it, expect } from 'vitest'
import { renderMarkdown, cellKey } from './report'
import type { CellResult, EvalRun, ScoredSummary } from './types'

function summary(over: Partial<ScoredSummary> = {}): ScoredSummary {
  return {
    activityId: 'a1',
    appName: 'Code',
    windowTitle: 'auth.ts',
    startOffsetMs: 0,
    endOffsetMs: 10_000,
    durationMs: 10_000,
    summary: 'Implemented the token-refresh guard.',
    summaryModel: 'google/gemini-2.5-flash',
    ocrText: '',
    deterministic: { checks: [], hardFails: 0, softWarns: 0, passRate: 1 },
    rubric: {
      dimensions: [{ key: 'mediaGrounding', score: 4, rationale: '' }],
      aggregate10: 8,
      capped: false,
      flaggedClaims: [],
      judgeModel: 'judge',
      samples: 1,
      tokensIn: 10,
      tokensOut: 5,
    },
    goldenId: null,
    ...over,
  }
}

function cell(over: Partial<CellResult> = {}): CellResult {
  return {
    fixture: 'vscode',
    videoModel: '',
    snapshotModel: 'google/gemini-2.5-flash',
    promptVariant: 'baseline',
    pipeline: 'auto',
    summaries: [summary()],
    golden: null,
    cost: {
      summaryTokensIn: 100,
      summaryTokensOut: 50,
      judgeTokensIn: 10,
      judgeTokensOut: 5,
      usd: 0.0123,
    },
    aggregate: {
      count: 1,
      avgRubric10: 8,
      detPassRate: 1,
      hardFails: 0,
      avgGoldenScore: null,
      p50DurationMs: 10_000,
    },
    producerStats: {
      emittedActivities: 1,
      droppedNoFrameWindows: 0,
      droppedUnknownContextWindows: 0,
      trailingFramesTrimmed: 0,
    },
    ...over,
  }
}

function run(over: Partial<EvalRun> = {}): EvalRun {
  return {
    runId: '2026-06-14T10-00-00-000Z',
    generatedAt: '2026-06-14T10:00:00.000Z',
    vendor: 'openrouter',
    judgeModel: 'google/gemini-2.5-flash',
    judgeTextOnly: false,
    cells: [cell()],
    baselineRunId: null,
    ...over,
  }
}

describe('cellKey', () => {
  it('formats fixture/models/prompt', () => {
    expect(cellKey(cell())).toBe('vscode | -/google/gemini-2.5-flash | baseline')
  })
})

describe('renderMarkdown', () => {
  it('renders the scorecard with the cell row', () => {
    const md = renderMarkdown(run())
    expect(md).toContain('# Activity-Summary Eval — 2026-06-14T10-00-00-000Z')
    expect(md).toContain('## Scorecard')
    expect(md).toContain('vscode')
    expect(md).toContain('Implemented the token-refresh guard.')
  })

  it('handles a deterministic-only run (no judge)', () => {
    const md = renderMarkdown(
      run({
        judgeModel: null,
        cells: [
          cell({
            aggregate: {
              count: 1,
              avgRubric10: null,
              detPassRate: 1,
              hardFails: 0,
              avgGoldenScore: null,
              p50DurationMs: 10_000,
            },
          }),
        ],
      }),
    )
    expect(md).not.toContain('## Rubric dimensions')
    expect(md).toContain('## Scorecard')
  })

  it('renders a baseline diff with deltas and changed summaries', () => {
    const current = run({
      cells: [
        cell({
          summaries: [summary({ summary: 'New and improved summary.' })],
          aggregate: {
            count: 1,
            avgRubric10: 9,
            detPassRate: 1,
            hardFails: 0,
            avgGoldenScore: null,
            p50DurationMs: 10_000,
          },
        }),
      ],
    })
    const baseline = run({
      runId: '2026-06-13T10-00-00-000Z',
      cells: [
        cell({
          summaries: [summary({ summary: 'Old summary.' })],
          aggregate: {
            count: 1,
            avgRubric10: 7,
            detPassRate: 1,
            hardFails: 0,
            avgGoldenScore: null,
            p50DurationMs: 10_000,
          },
        }),
      ],
    })
    const md = renderMarkdown(current, baseline)
    expect(md).toContain('Δ vs baseline')
    expect(md).toContain('+2.00') // rubric 9 - 7
    expect(md).toContain('old: Old summary.')
    expect(md).toContain('new: New and improved summary.')
  })
})
