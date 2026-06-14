import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './report'
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
    judge: {
      score10: 8,
      notes: '',
      flaggedClaims: [],
      judgeModel: 'judge',
      tokensIn: 10,
      tokensOut: 5,
    },
    golden: null,
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
    avgJudge10: 8,
    segmentation: null,
    avgEquivalence: null,
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
    expect(md).toContain('judge 8.00')
  })

  it('handles a deterministic-only run (no judge)', () => {
    const md = renderMarkdown(
      report({
        judgeModel: null,
        fixtures: [fixtureScore({ avgJudge10: null, summaries: [summary({ judge: null })] })],
      }),
    )
    expect(md).toContain('(none — deterministic only)')
    expect(md).toContain('## Scorecard')
    expect(md).toContain('judge —')
  })

  it('surfaces hard fails and flagged claims', () => {
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
                judge: {
                  score10: 3,
                  notes: '',
                  flaggedClaims: ['claims a PR was merged'],
                  judgeModel: 'judge',
                  tokensIn: 1,
                  tokensOut: 1,
                },
              }),
            ],
          }),
        ],
      }),
    )
    expect(md).toContain('1 hard-fail(s)')
    expect(md).toContain('noRawInteractionVocab')
    expect(md).toContain('flagged: claims a PR was merged')
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
})
