import { describe, it, expect } from 'vitest'
import { scorePatternFixture, bestDetectedForGolden } from './pattern-score'
import type { DetectedPattern, PatternFixture, PatternGolden } from './pattern-types'

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function fixture(golden: PatternGolden): PatternFixture {
  return {
    dir: '/tmp/fix',
    manifest: {
      name: 'fix',
      label: 'fix',
      description: '',
      activityCount: 0,
      needlePatternCount: golden.patterns.length,
      schemaVersion: 1,
    },
    activities: [],
    golden,
  }
}

function detected(
  id: string,
  name: string,
  activityIdsPerSighting: string[][],
  confidence = 0.8,
): DetectedPattern {
  return {
    id,
    name,
    description: '',
    apps: [],
    automationIdea: '',
    sightingCount: activityIdsPerSighting.length,
    sightings: activityIdsPerSighting.map((activityIds) => ({
      activityIds,
      confidence,
      evidence: '',
      durationEstimateMin: 5,
    })),
  }
}

const GOLDEN: PatternGolden = {
  patterns: [
    {
      id: 'g1',
      name: 'Credit tracking',
      description: '',
      apps: [],
      automationIdea: '',
      needleActivityIds: ['n1', 'n2', 'n3', 'n4'],
      minSightings: 2,
    },
  ],
}

const ZERO_TOKENS = { total: { input: 0, output: 0 } }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bestDetectedForGolden', () => {
  it('picks the detection with the most needle overlap', () => {
    const a = detected('a', 'A', [['n1']])
    const b = detected('b', 'B', [['n1', 'n2', 'n3']])
    const best = bestDetectedForGolden(['n1', 'n2', 'n3', 'n4'], [a, b])
    expect(best?.pattern.id).toBe('b')
    expect(best?.overlap).toBe(3)
  })

  it('returns null when nothing overlaps', () => {
    const a = detected('a', 'A', [['x', 'y']])
    expect(bestDetectedForGolden(['n1', 'n2'], [a])).toBeNull()
  })
})

describe('scorePatternFixture', () => {
  it('marks a golden found when grounding recall ≥ 0.5 and minSightings met', () => {
    const d = detected('p', 'Credit tracking', [
      ['n1', 'n2'],
      ['n3', 'n4'],
    ])
    const score = scorePatternFixture({
      fixture: fixture(GOLDEN),
      model: 'm',
      detected: [d],
      tokenUsage: ZERO_TOKENS,
    })
    expect(score.foundCount).toBe(1)
    expect(score.recall).toBe(1)
    expect(score.goldenScores[0].found).toBe(true)
    expect(score.goldenScores[0].grounding.recall).toBe(1)
    expect(score.goldenScores[0].grounding.precision).toBe(1)
    expect(score.spuriousCount).toBe(0)
  })

  it('does not count a weak partial match as found, but it is not spurious either', () => {
    // Overlaps 1 of 4 needle ids → recall 0.25 < 0.5.
    const d = detected('p', 'Maybe credits', [['n1']])
    const score = scorePatternFixture({
      fixture: fixture(GOLDEN),
      model: 'm',
      detected: [d],
      tokenUsage: ZERO_TOKENS,
    })
    expect(score.goldenScores[0].found).toBe(false)
    expect(score.foundCount).toBe(0)
    // Overlaps a needle, so it's a partial detection — not a false positive.
    expect(score.spuriousCount).toBe(0)
  })

  it('fails the found check when minSightings is not met', () => {
    // Recall is 1 but only a single sighting; golden requires 2.
    const d = detected('p', 'Credit tracking', [['n1', 'n2', 'n3', 'n4']])
    const score = scorePatternFixture({
      fixture: fixture(GOLDEN),
      model: 'm',
      detected: [d],
      tokenUsage: ZERO_TOKENS,
    })
    expect(score.goldenScores[0].grounding.recall).toBe(1)
    expect(score.goldenScores[0].found).toBe(false)
  })

  it('counts detections overlapping no needle as spurious', () => {
    const real = detected('p', 'Credit tracking', [['n1', 'n2', 'n3', 'n4']])
    const noise = detected('q', 'You write a lot of code', [['x1', 'x2']])
    const score = scorePatternFixture({
      fixture: fixture(GOLDEN),
      model: 'm',
      detected: [real, noise],
      tokenUsage: ZERO_TOKENS,
    })
    expect(score.spuriousCount).toBe(1)
    expect(score.spuriousNames).toEqual(['You write a lot of code'])
  })

  it('whitelists acceptableExtraPatterns by name substring', () => {
    const golden: PatternGolden = {
      ...GOLDEN,
      acceptableExtraPatterns: ['email triage'],
    }
    const noise = detected('q', 'Daily email triage', [['x1']])
    const score = scorePatternFixture({
      fixture: fixture(golden),
      model: 'm',
      detected: [noise],
      tokenUsage: ZERO_TOKENS,
    })
    expect(score.spuriousCount).toBe(0)
  })

  it('lowers precision when the detection includes non-needle activity ids', () => {
    const d = detected('p', 'Credit tracking', [['n1', 'n2', 'n3', 'n4', 'extra1', 'extra2']])
    const score = scorePatternFixture({
      fixture: fixture({ patterns: [{ ...GOLDEN.patterns[0], minSightings: 1 }] }),
      model: 'm',
      detected: [d],
      tokenUsage: ZERO_TOKENS,
    })
    expect(score.goldenScores[0].grounding.recall).toBe(1)
    expect(score.goldenScores[0].grounding.precision).toBeCloseTo(4 / 6)
    expect(score.goldenScores[0].grounding.iou).toBeCloseTo(4 / 6)
  })

  it('folds judge results into the aggregate for found goldens', () => {
    const d = detected('p', 'Credit tracking', [
      ['n1', 'n2'],
      ['n3', 'n4'],
    ])
    const judge = new Map([
      ['g1', { equivalence: 0.9, automationQuality: 8, automationNotes: 'concrete API' }],
    ])
    const score = scorePatternFixture({
      fixture: fixture(GOLDEN),
      model: 'm',
      detected: [d],
      tokenUsage: ZERO_TOKENS,
      judge,
    })
    expect(score.avgEquivalence).toBe(0.9)
    expect(score.avgAutomationQuality).toBe(8)
    expect(score.goldenScores[0].automationNotes).toBe('concrete API')
  })

  it('reports recall 0 with no detections', () => {
    const score = scorePatternFixture({
      fixture: fixture(GOLDEN),
      model: 'm',
      detected: [],
      tokenUsage: ZERO_TOKENS,
    })
    expect(score.recall).toBe(0)
    expect(score.foundCount).toBe(0)
    expect(score.goldenScores[0].matchedPatternId).toBeNull()
  })
})
