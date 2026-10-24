import { describe, it, expect } from 'vitest'
import { compareArms, renderCompareMarkdown, reviewFirst, type Arm } from './compare'
import type { EvalReport, FixtureScore, GoldenMatch, ScoredSummary } from './types'

function golden(index: number, over: Partial<GoldenMatch> = {}): GoldenMatch {
  return {
    index,
    summary: `golden ${index}`,
    overlapRatio: 1,
    equivalence: null,
    mustMentionRecall: null,
    mustMentionMissed: [],
    unexpectedRedactions: [],
    ...over,
  }
}

function summary(over: Partial<ScoredSummary> = {}): ScoredSummary {
  return {
    activityId: 'a',
    appName: 'Chrome',
    windowTitle: 'Sheet',
    startOffsetMs: 0,
    endOffsetMs: 5_000,
    durationMs: 5_000,
    summary: 'did a thing',
    summaryModel: 'm',
    ocrText: '',
    deterministic: { checks: [], hardFails: 0, softWarns: 0, passRate: 1 },
    golden: golden(1),
    summaryTokensIn: 0,
    summaryTokensOut: 0,
    summaryCostUsd: 0.001,
    judgeCostUsd: null,
    diagnostics: null,
    ...over,
  }
}

function fixture(summaries: ScoredSummary[], over: Partial<FixtureScore> = {}): FixtureScore {
  const det = summaries.map((s) => s.deterministic).filter((d) => d !== null)
  return {
    fixture: 'f1',
    model: 'm',
    summaries,
    producerStats: {
      emittedActivities: summaries.length,
      droppedNoFrameWindows: 0,
      droppedUnknownContextWindows: 0,
      trailingFramesTrimmed: 0,
    },
    detPassRate: 1,
    hardFails: det.reduce((n, d) => n + d.hardFails, 0),
    segmentation: null,
    avgEquivalence: null,
    avgMustMention: null,
    costUsd: 0.001 * summaries.length,
    judgeCostUsd: null,
    ...over,
  }
}

function report(fixtures: FixtureScore[], over: Partial<EvalReport> = {}): EvalReport {
  return {
    generatedAt: '2026-10-21T09:00:00.000Z',
    label: null,
    vendor: 'openrouter',
    pipeline: 'video',
    judgeModel: null,
    gitSha: 'abc1234567890',
    gitDirty: false,
    fixtures,
    ...over,
  }
}

const arm = (name: string, ...reports: EvalReport[]): Arm => ({
  name,
  runIds: reports.map((_, i) => `${name.toLowerCase()}${i + 1}`),
  reports,
})

const hardFail = {
  checks: [{ id: 'noRawInteractionVocab', passed: false, severity: 'hard' as const }],
  hardFails: 1,
  softWarns: 0,
  passRate: 0,
}

describe('compareArms', () => {
  it('matches activities by golden index and lists unmatched ones separately', () => {
    const a = arm('A', report([fixture([summary(), summary({ golden: golden(2) })])]))
    const b = arm(
      'B',
      report([
        fixture([
          summary({ summary: 'B first' }),
          summary({ golden: golden(2), summary: 'B second' }),
          summary({ golden: null, summary: 'B extra', startOffsetMs: 9_000 }),
        ]),
      ]),
    )
    const [f] = compareArms(a, b)
    expect(f.activities.map((x) => x.goldenIndex)).toEqual([1, 2])
    expect(f.activities[0].b[0].summary.summary).toBe('B first')
    expect(f.unmatched.b).toHaveLength(1)
    expect(f.unmatched.a).toHaveLength(0)
  })

  it('flags must-mention flips and hard-fail changes, not equal states', () => {
    const a = arm(
      'A',
      report([
        fixture([
          summary({ golden: golden(1, { mustMentionMissed: ['Mercury'] }) }),
          summary({ golden: golden(2), deterministic: hardFail }),
          summary({ golden: golden(3), deterministic: hardFail }),
        ]),
      ]),
    )
    const b = arm(
      'B',
      report([
        fixture([
          summary({ golden: golden(1) }),
          summary({ golden: golden(2) }),
          summary({ golden: golden(3), deterministic: hardFail }),
        ]),
      ]),
    )
    const [f] = compareArms(a, b)
    expect(f.activities[0].mentionFlipped).toEqual(['Mercury'])
    expect(f.activities[1].hardFailChanged).toBe(true)
    expect(f.activities[2].hardFailChanged).toBe(false)
    expect(reviewFirst([f]).map((x) => x.goldenIndex)).toEqual([1, 2])
  })

  it('uses equivalence deltas only when both arms were judged', () => {
    const a = arm('A', report([fixture([summary({ golden: golden(1, { equivalence: 0.9 }) })])]))
    const bJudged = arm(
      'B',
      report([fixture([summary({ golden: golden(1, { equivalence: 0.75 }) })])]),
    )
    const bUnjudged = arm('B', report([fixture([summary()])]))
    expect(compareArms(a, bJudged)[0].activities[0].delta).toBeCloseTo(-0.15)
    expect(reviewFirst(compareArms(a, bJudged))).toHaveLength(1)
    expect(compareArms(a, bUnjudged)[0].activities[0].delta).toBeNull()
    expect(reviewFirst(compareArms(a, bUnjudged))).toHaveLength(0)
    const small = arm(
      'B',
      report([fixture([summary({ golden: golden(1, { equivalence: 0.85 }) })])]),
    )
    expect(reviewFirst(compareArms(a, small))).toHaveLength(0)
  })

  it('averages repeated runs per arm', () => {
    const a = arm(
      'A',
      report([fixture([summary({ deterministic: hardFail })])]),
      report([fixture([summary()])]),
    )
    const b = arm('B', report([fixture([summary()])]))
    const [f] = compareArms(a, b)
    expect(f.activities[0].a).toHaveLength(2)
    expect(f.a?.hardFails).toBe(0.5)
    expect(f.a?.costUsd).toBeCloseTo(0.001)
    expect(f.b?.hardFails).toBe(0)
  })

  it('rejects a multi-model run', () => {
    const a = arm('A', report([fixture([summary()]), fixture([summary()], { model: 'other' })]))
    const b = arm('B', report([fixture([summary()])]))
    expect(() => compareArms(a, b)).toThrow(/one model per run/)
  })
})

describe('renderCompareMarkdown', () => {
  it('renders provenance, metrics without an Equiv column, review-first and the worksheet', () => {
    const a = arm(
      'A',
      report([fixture([summary({ golden: golden(1, { mustMentionMissed: ['95'] }) })])], {
        label: 'baseline',
      }),
    )
    const b = arm(
      'B',
      report([fixture([summary({ summary: 'entered 95', deterministic: hardFail })])], {
        label: 'enriched',
        gitDirty: true,
      }),
    )
    const md = renderCompareMarkdown(a, b, compareArms(a, b))
    expect(md).toContain('- a1: label baseline · git abc1234567 · pipeline video · m · judge none')
    expect(md).toContain('- b1: label enriched · git abc1234567 (dirty)')
    expect(md).not.toContain('Equiv')
    expect(md).toContain('| **overall** (1 shared) |')
    expect(md).toContain('- f1 #1 [Chrome] hard-fail no → yes · flipped: 95')
    expect(md).toContain('### f1 #1 [0:00–0:05] Chrome — Sheet')
    expect(md).toContain('golden: golden 1')
    expect(md).toContain('A a1 (missed: 95): did a thing')
    expect(md).toContain('B b1 (hard: noRawInteractionVocab): entered 95')
  })

  it('adds the Equiv columns when judged and notes a missing arm', () => {
    const a = arm('A', report([fixture([summary({ golden: golden(1, { equivalence: 0.8 }) })])]))
    const b = arm('B', report([fixture([summary({ golden: golden(2, { equivalence: 0.6 }) })])]))
    const md = renderCompareMarkdown(a, b, compareArms(a, b))
    expect(md).toContain('| Fixture | Equiv A | B | Δ |')
    expect(md).toContain('B: (no activity matched this block)')
    expect(md).toContain('A: (no activity matched this block)')
    expect(md).toContain('(equiv 0.80)')
  })
})
