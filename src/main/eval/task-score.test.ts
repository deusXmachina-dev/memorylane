import { describe, it, expect } from 'vitest'
import { scoreTaskFixture, bestDetectedForGolden } from './task-score'
import type {
  DetectedSighting,
  GoldenSighting,
  GoldenVerdict,
  TaskFixture,
  TaskGolden,
} from './task-types'

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function golden(title: string, verdict: GoldenVerdict, activityIds: string[]): GoldenSighting {
  return { title, description: '', apps: [], activityIds, verdict }
}

function fixture(sightings: GoldenSighting[]): TaskFixture {
  return {
    dir: '/tmp/fix',
    manifest: { name: 'fix', label: 'fix', description: '', activityCount: 0, schemaVersion: 3 },
    activities: [],
    golden: { sightings } satisfies TaskGolden,
  }
}

function detected(id: string, title: string, activityIds: string[]): DetectedSighting {
  return {
    id,
    title,
    subject: '',
    description: '',
    steps: [],
    apps: [],
    activityIds,
    interactionMin: 5,
  }
}

const ZERO_TOKENS = { total: { input: 0, output: 0 } }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bestDetectedForGolden', () => {
  it('picks the sighting with the most golden overlap', () => {
    const a = detected('a', 'A', ['a1'])
    const b = detected('b', 'B', ['a1', 'a2', 'a3'])
    const best = bestDetectedForGolden(['a1', 'a2', 'a3', 'a4'], [a, b])
    expect(best?.sighting.id).toBe('b')
    expect(best?.overlap).toBe(3)
  })

  it('returns null when nothing overlaps', () => {
    expect(bestDetectedForGolden(['a1'], [detected('a', 'A', ['x'])])).toBeNull()
  })
})

describe('scoreTaskFixture', () => {
  it('marks a keep task found when a detection covers ≥ 50% of its ids', () => {
    const d = detected('s', 'Submit expense report', ['a1', 'a2', 'a3', 'a4'])
    const score = scoreTaskFixture({
      fixture: fixture([golden('Submit expense report', 'keep', ['a1', 'a2', 'a3', 'a4'])]),
      model: 'm',
      detected: [d],
      tokenUsage: ZERO_TOKENS,
    })
    expect(score.positiveCount).toBe(1)
    expect(score.foundCount).toBe(1)
    expect(score.recall).toBe(1)
    expect(score.missedTitles).toEqual([])
    expect(score.newCount).toBe(0)
    expect(score.rejectedReproducedCount).toBe(0)
  })

  it('lists a keep task as missed when nothing matches it', () => {
    const score = scoreTaskFixture({
      fixture: fixture([golden('Submit expense report', 'keep', ['a1', 'a2', 'a3', 'a4'])]),
      model: 'm',
      detected: [detected('s', 'Unrelated', ['b1'])],
      tokenUsage: ZERO_TOKENS,
    })
    expect(score.foundCount).toBe(0)
    expect(score.missedTitles).toEqual(['Submit expense report'])
    // The unrelated detection matches no golden block → new.
    expect(score.newCount).toBe(1)
  })

  it('counts a detection reproducing a reject block', () => {
    const score = scoreTaskFixture({
      fixture: fixture([
        golden('Submit expense report', 'keep', ['a1', 'a2']),
        golden('Idle browsing', 'reject', ['b1', 'b2']),
      ]),
      model: 'm',
      detected: [detected('q', 'Research session', ['b1', 'b2'])],
      tokenUsage: ZERO_TOKENS,
    })
    expect(score.rejectedReproducedCount).toBe(1)
    expect(score.rejectedReproducedTitles).toEqual(['Idle browsing'])
    expect(score.rejectsReproducedCount).toBe(1)
    expect(score.newCount).toBe(0)
    // The keep task wasn't produced.
    expect(score.missedTitles).toEqual(['Submit expense report'])
  })

  it('counts every detection reproducing the same reject block', () => {
    const score = scoreTaskFixture({
      fixture: fixture([golden('Idle browsing', 'reject', ['b1', 'b2'])]),
      model: 'm',
      detected: [
        detected('q1', 'Research session', ['b1', 'b2']),
        detected('q2', 'Browsing recap', ['b1', 'b2']),
      ],
      tokenUsage: ZERO_TOKENS,
    })
    // Title set dedupes; the detection-level count does not.
    expect(score.rejectedReproducedCount).toBe(1)
    expect(score.rejectsReproducedCount).toBe(2)
  })

  it('reports a detection matching no golden block as new (not a failure)', () => {
    const found = detected('s', 'Submit expense report', ['a1', 'a2', 'a3', 'a4'])
    const fresh = detected('n', 'Something else entirely', ['z1', 'z2'])
    const score = scoreTaskFixture({
      fixture: fixture([golden('Submit expense report', 'keep', ['a1', 'a2', 'a3', 'a4'])]),
      model: 'm',
      detected: [found, fresh],
      tokenUsage: ZERO_TOKENS,
    })
    expect(score.foundCount).toBe(1)
    expect(score.newCount).toBe(1)
    expect(score.newSightings[0].title).toBe('Something else entirely')
  })

  it('does not call a detection new when it overlaps an unreviewed block', () => {
    const score = scoreTaskFixture({
      fixture: fixture([golden('Parked candidate', 'unreviewed', ['c1', 'c2'])]),
      model: 'm',
      detected: [detected('d', 'Same thing', ['c1', 'c2'])],
      tokenUsage: ZERO_TOKENS,
    })
    // Not scored as keep/reject, but already parked → not "new".
    expect(score.newCount).toBe(0)
    expect(score.unreviewedMatchedCount).toBe(1)
    expect(score.positiveCount).toBe(0)
  })

  it('puts every detection in exactly one bucket', () => {
    const score = scoreTaskFixture({
      fixture: fixture([
        golden('Keep task', 'keep', ['a1', 'a2', 'a3']),
        golden('Reject task', 'reject', ['b1', 'b2']),
        golden('Parked', 'unreviewed', ['c1', 'c2']),
      ]),
      model: 'm',
      detected: [
        detected('f', 'Found it', ['a1', 'a2']),
        detected('r', 'Dumb again', ['b1', 'b2']),
        detected('u', 'Parked again', ['c1', 'c2']),
        detected('g', 'Graze', ['a3', 'x1', 'x2']),
        detected('n', 'Brand new', ['z1', 'z2']),
      ],
      tokenUsage: ZERO_TOKENS,
    })
    expect(score.foundDetectionsCount).toBe(1)
    expect(score.rejectsReproducedCount).toBe(1)
    expect(score.unreviewedMatchedCount).toBe(1)
    expect(score.partialGrazeCount).toBe(1)
    expect(score.newCount).toBe(1)
    expect(
      score.foundDetectionsCount +
        score.rejectsReproducedCount +
        score.unreviewedMatchedCount +
        score.partialGrazeCount +
        score.newCount,
    ).toBe(score.detectedCount)
  })

  it('buckets a sub-threshold overlap as graze, not new or unreviewed', () => {
    const score = scoreTaskFixture({
      fixture: fixture([
        golden('Keep task', 'keep', ['a1', 'a2', 'a3']),
        golden('Parked', 'unreviewed', ['c1', 'c2', 'c3']),
      ]),
      model: 'm',
      detected: [detected('g1', 'Keep graze', ['a1']), detected('g2', 'Parked graze', ['c1'])],
      tokenUsage: ZERO_TOKENS,
    })
    // g1 is the best match for the keep but covers < 50% → the keep is missed.
    expect(score.foundCount).toBe(0)
    expect(score.partialGrazeCount).toBe(2)
    expect(score.unreviewedMatchedCount).toBe(0)
    expect(score.newCount).toBe(0)
  })

  it('flags one detection that bundles multiple keep tasks', () => {
    const d = detected('s', 'A and B', ['a1', 'a2', 'b1', 'b2'])
    const score = scoreTaskFixture({
      fixture: fixture([
        golden('Task A', 'keep', ['a1', 'a2']),
        golden('Task B', 'keep', ['b1', 'b2']),
      ]),
      model: 'm',
      detected: [d],
      tokenUsage: ZERO_TOKENS,
    })
    expect(score.foundCount).toBe(2)
    expect(score.bundledSightingIds).toEqual(['s'])
  })

  it('folds judge results into the aggregate for found tasks', () => {
    const d = detected('s', 'Submit expense report', ['a1', 'a2', 'a3', 'a4'])
    const judge = new Map([['Submit expense report', { equivalence: 0.9 }]])
    const score = scoreTaskFixture({
      fixture: fixture([golden('Submit expense report', 'keep', ['a1', 'a2', 'a3', 'a4'])]),
      model: 'm',
      detected: [d],
      tokenUsage: ZERO_TOKENS,
      judge,
    })
    expect(score.avgEquivalence).toBe(0.9)
    expect(score.goldenScores[0].equivalence).toBe(0.9)
  })

  it('reports recall 0 with no detections', () => {
    const score = scoreTaskFixture({
      fixture: fixture([golden('Submit expense report', 'keep', ['a1', 'a2'])]),
      model: 'm',
      detected: [],
      tokenUsage: ZERO_TOKENS,
    })
    expect(score.recall).toBe(0)
    expect(score.missedTitles).toEqual(['Submit expense report'])
    expect(score.goldenScores[0].matchedSightingId).toBeNull()
  })
})

describe('id precision', () => {
  it('classifies every cited id as inKeep / inReject / unlabeled', () => {
    const score = scoreTaskFixture({
      fixture: fixture([
        golden('Keep task', 'keep', ['a1', 'a2']),
        golden('Reject task', 'reject', ['b1']),
        golden('Parked', 'unreviewed', ['c1']),
      ]),
      model: 'm',
      // Ids in the '?' block (c1) and unknown ids (z1) are both unlabeled.
      detected: [detected('d', 'Mixed bag', ['a1', 'a2', 'b1', 'c1', 'z1'])],
      tokenUsage: ZERO_TOKENS,
    })
    expect(score.citedIds).toEqual({ inKeep: 2, inReject: 1, unlabeled: 2, total: 5 })
    expect(score.idPrecision).toBe(2 / 5)
  })

  it('counts citations across detections, not unique ids', () => {
    const score = scoreTaskFixture({
      fixture: fixture([
        golden('Keep task', 'keep', ['a1', 'a2']),
        golden('Reject task', 'reject', ['b1', 'b2']),
      ]),
      model: 'm',
      detected: [
        detected('d1', 'Good', ['a1', 'a2']),
        detected('d2', 'Junk', ['b1', 'b2']),
        detected('d3', 'More junk', ['b1', 'b2']),
      ],
      tokenUsage: ZERO_TOKENS,
    })
    expect(score.citedIds).toEqual({ inKeep: 2, inReject: 4, unlabeled: 0, total: 6 })
    expect(score.idPrecision).toBe(2 / 6)
  })

  it('is null with no detections', () => {
    const score = scoreTaskFixture({
      fixture: fixture([golden('Keep task', 'keep', ['a1', 'a2'])]),
      model: 'm',
      detected: [],
      tokenUsage: ZERO_TOKENS,
    })
    expect(score.citedIds.total).toBe(0)
    expect(score.idPrecision).toBeNull()
  })
})
