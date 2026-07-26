import { describe, it, expect } from 'vitest'
import { renderMarkdown, renderComparisonMarkdown } from './report'
import type { EvalReport, FixtureScore, ScoredSummary } from './types'

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
    golden: null,
    summaryTokensIn: 1000,
    summaryTokensOut: 50,
    summaryCostUsd: 0.0004,
    judgeCostUsd: 0.0002,
    ...over,
  }
}

function fixtureScore(over: Partial<FixtureScore> = {}): FixtureScore {
  return {
    fixture: 'vscode',
    model: 'google/gemini-2.5-flash',
    summaries: [summary()],
    producerStats: {
      emittedActivities: 1,
      droppedNoFrameWindows: 0,
      droppedUnknownContextWindows: 0,
      trailingFramesTrimmed: 0,
    },
    detPassRate: 1,
    hardFails: 0,
    segmentation: null,
    avgEquivalence: null,
    costUsd: 0.0004,
    judgeCostUsd: 0.0002,
    ...over,
  }
}

function report(over: Partial<EvalReport> = {}): EvalReport {
  return {
    generatedAt: '2026-06-14T10:00:00.000Z',
    vendor: 'openrouter',
    judgeModel: 'google/gemini-2.5-flash',
    fixtures: [fixtureScore()],
    ...over,
  }
}

describe('renderMarkdown', () => {
  it('renders the scorecard and per-summary detail', () => {
    const md = renderMarkdown(report())
    expect(md).toContain('# Activity-Summary Eval — 2026-06-14T10:00:00.000Z')
    expect(md).toContain('## Scorecard')
    expect(md).toContain('vscode')
    expect(md).toContain('Implemented the token-refresh guard.')
    expect(md).toContain('equiv —')
  })

  it('handles a deterministic-only run (no judge)', () => {
    const md = renderMarkdown(report({ judgeModel: null }))
    expect(md).toContain('(none — deterministic only)')
    expect(md).toContain('## Scorecard')
    expect(md).toContain('equiv —')
  })

  it('surfaces hard fails', () => {
    const md = renderMarkdown(
      report({
        fixtures: [
          fixtureScore({
            hardFails: 1,
            summaries: [
              summary({
                deterministic: {
                  checks: [
                    {
                      id: 'noRawInteractionVocab',
                      passed: false,
                      severity: 'hard',
                      detail: 'Mentions raw interaction: "clicked"',
                    },
                  ],
                  hardFails: 1,
                  softWarns: 0,
                  passRate: 0,
                },
              }),
            ],
          }),
        ],
      }),
    )
    expect(md).toContain('1 hard-fail(s)')
    expect(md).toContain('noRawInteractionVocab')
  })

  it('renders a heuristic summary without a deterministic verdict', () => {
    const md = renderMarkdown(
      report({
        fixtures: [
          fixtureScore({
            detPassRate: null,
            summaries: [
              summary({
                summaryModel: 'heuristic:viewed',
                summary: 'Viewed MemoryLane',
                deterministic: null,
              }),
            ],
          }),
        ],
      }),
    )
    expect(md).toContain('Viewed MemoryLane')
    expect(md).toContain('| — | 0 |') // Det pass% — hard fails 0
    expect(md).not.toContain('hard-fail(s)')
  })

  it('renders segmentation coverage and golden equivalence', () => {
    const md = renderMarkdown(
      report({
        fixtures: [
          fixtureScore({
            segmentation: {
              goldenCount: 2,
              coverage: 0.5,
              unmatchedGoldenIndexes: [2],
              extraActivityCount: 1,
              expectedDropCount: 0,
              dropViolationIndexes: [],
            },
            avgEquivalence: 0.82,
            summaries: [
              summary({
                golden: {
                  index: 1,
                  summary: 'Debugged the auth middleware.',
                  overlapRatio: 0.9,
                  equivalence: 0.82,
                },
              }),
            ],
          }),
        ],
      }),
    )
    expect(md).toContain('| 50% | 0.82 |') // Seg% + Equiv columns
    expect(md).toContain('missed/merged blocks: 2')
    expect(md).toContain('1 extra activity')
    expect(md).toContain('equiv 0.82')
    expect(md).toContain('golden #1: Debugged the auth middleware.')
  })

  it('shows summarizer cost in the scorecard', () => {
    const md = renderMarkdown(report({ fixtures: [fixtureScore({ costUsd: 0.0123 })] }))
    expect(md).toContain('Cost (USD)')
    expect(md).toContain('$0.0123')
  })
})

describe('renderComparisonMarkdown', () => {
  it('returns null when there is one variant and no golden', () => {
    expect(renderComparisonMarkdown(report())).toBeNull()
  })

  it('renders golden vs a single model side by side when a golden exists', () => {
    const cmp = renderComparisonMarkdown(
      report({
        fixtures: [
          fixtureScore({
            model: 'model-a',
            summaries: [
              summary({
                summaryModel: 'model-a',
                summary: 'A summary from model A.',
                golden: {
                  index: 1,
                  summary: 'Debugged the auth middleware.',
                  overlapRatio: 0.9,
                  equivalence: 0.8,
                },
              }),
            ],
          }),
        ],
      }),
    )!
    expect(cmp).toContain('| Activity | golden | model-a |')
    expect(cmp).toContain('**#1**<br>Debugged the auth middleware.')
    expect(cmp).toContain('**equiv 0.80**<br>A summary from model A.')
  })

  it('pivots two models of the same fixture side by side, keyed by golden block', () => {
    const golden = { index: 1, summary: 'Debugged the auth middleware.', overlapRatio: 0.9 }
    const cmp = renderComparisonMarkdown(
      report({
        fixtures: [
          fixtureScore({
            model: 'model-a',
            costUsd: 0.001,
            summaries: [
              summary({
                summaryModel: 'model-a',
                summary: 'A summary from model A.',
                golden: { ...golden, equivalence: 0.8 },
              }),
            ],
          }),
          fixtureScore({
            model: 'model-b',
            costUsd: 0.002,
            summaries: [
              summary({
                summaryModel: 'model-b',
                summary: 'A summary from model B.',
                golden: { ...golden, equivalence: 0.4 },
              }),
            ],
          }),
        ],
      }),
    )!
    expect(cmp).toContain('# Activity-Summary Comparison')
    // Both variants appear in the rollup with their costs.
    expect(cmp).toContain('$0.0010')
    expect(cmp).toContain('$0.0020')
    // A columnar table: golden + each variant are columns on one activity row.
    expect(cmp).toContain('| Activity | golden | model-a | model-b |')
    expect(cmp).toContain('**#1**<br>Debugged the auth middleware.')
    expect(cmp).toContain('**equiv 0.80**<br>A summary from model A.')
    expect(cmp).toContain('**equiv 0.40**<br>A summary from model B.')
  })

  it('surfaces model-chain fallback (requested → actual) when the model differs', () => {
    // Snapshot-only model requested, but the chain fell through to flash-lite.
    const md = renderMarkdown(
      report({
        fixtures: [
          fixtureScore({
            model: 'mistralai/mistral-small-3.2-24b-instruct',
            summaries: [summary({ summaryModel: 'google/gemini-2.5-flash-lite' })],
          }),
        ],
      }),
    )
    expect(md).toContain('mistralai/mistral-small-3.2-24b-instruct → google/gemini-2.5-flash-lite')
  })
})
