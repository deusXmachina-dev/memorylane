import { describe, expect, it } from 'vitest'
import type {
  ActivityRepository,
  PatternRepository,
  PatternSighting,
  PatternWithStats,
} from '../../storage'
import type { ActivitySummary, StoredActivity } from '../../storage/types'
import {
  evaluateRecentActivityPatternMatcher,
  replayPatternNotifications,
  type GroundTruthSighting,
} from './evaluation'
import type { RecentActivityPatternMatcher } from './types'

function makePattern(id: string, name: string): PatternWithStats {
  return {
    id,
    name,
    description: `${name} description`,
    apps: ['Code'],
    automationIdea: '',
    createdAt: 1_000,
    rejectedAt: null,
    promptCopiedAt: null,
    approvedAt: null,
    completedAt: null,
    sightingCount: 0,
    lastSeenAt: null,
    lastConfidence: null,
  }
}

function makeSighting(id: string, patternId: string, activityIds: string[]): PatternSighting {
  return {
    id,
    patternId,
    detectedAt: 1_000,
    runId: 'run-1',
    evidence: '',
    activityIds,
    confidence: 0.9,
    durationEstimateMin: null,
  }
}

function makeStoredActivity(id: string, startTimestamp: number): StoredActivity {
  return {
    id,
    startTimestamp,
    endTimestamp: startTimestamp + 1_000,
    appName: 'Code',
    windowTitle: `Window ${id}`,
    tld: 'github.com',
    summary: `summary:${id}`,
    ocrText: `ocr:${id}`,
    vector: [0.1, 0.2, 0.3],
  }
}

describe('recent activity pattern evaluation', () => {
  it('builds ground truth, replays notifications, and computes tp/fn/fp metrics', async () => {
    const patterns = [
      { ...makePattern('pattern-a', 'Pattern A'), sightingCount: 1 },
      { ...makePattern('pattern-b', 'Pattern B'), sightingCount: 1 },
      { ...makePattern('pattern-c', 'Pattern C'), sightingCount: 0 },
    ]
    const sightingsByPattern = new Map<string, PatternSighting[]>([
      ['pattern-a', [makeSighting('sighting-a1', 'pattern-a', ['a1', 'a2'])]],
      ['pattern-b', [makeSighting('sighting-b1', 'pattern-b', ['b1', 'b2'])]],
    ])
    const storedActivities = [
      makeStoredActivity('a1', 1_000),
      makeStoredActivity('a2', 2_000),
      makeStoredActivity('x1', 3_000),
      makeStoredActivity('b1', 5 * 60 * 60 * 1000),
      makeStoredActivity('b2', 5 * 60 * 60 * 1000 + 1_000),
    ]
    const summaries: ActivitySummary[] = storedActivities.map((activity) => ({
      id: activity.id,
      startTimestamp: activity.startTimestamp,
      endTimestamp: activity.endTimestamp,
      appName: activity.appName,
      windowTitle: activity.windowTitle,
      summary: activity.summary,
    }))

    const patternRepository: Pick<PatternRepository, 'getAllPatterns' | 'getSightingsForPattern'> =
      {
        getAllPatterns: () => patterns,
        getSightingsForPattern: (patternId) => sightingsByPattern.get(patternId) ?? [],
      } as Pick<PatternRepository, 'getAllPatterns' | 'getSightingsForPattern'>

    const activityRepository: Pick<ActivityRepository, 'getByIds' | 'getByTimeRange'> = {
      getByIds: (ids) =>
        ids
          .map((id) => storedActivities.find((activity) => activity.id === id))
          .filter((activity): activity is StoredActivity => activity !== undefined),
      getByTimeRange: (startTime, endTime) =>
        summaries.filter(
          (activity) =>
            (startTime === null || activity.endTimestamp >= startTime) &&
            (endTime === null || activity.startTimestamp <= endTime),
        ),
    } as Pick<ActivityRepository, 'getByIds' | 'getByTimeRange'>

    const matcher: RecentActivityPatternMatcher = {
      match: async ({ recentActivities, patterns: activePatterns, now }) => {
        const latest = recentActivities[recentActivities.length - 1]
        if (!latest) return null

        const patternA = activePatterns.find((pattern) => pattern.id === 'pattern-a')
        const patternC = activePatterns.find((pattern) => pattern.id === 'pattern-c')
        if (latest.id === 'a2' && patternA) {
          return {
            patternId: patternA.id,
            patternName: patternA.name,
            confidence: 0.9,
            supportingActivityIds: ['a1', 'a2'],
            reason: `matched at ${now}`,
          }
        }

        if (latest.id === 'x1' && patternC) {
          return {
            patternId: patternC.id,
            patternName: patternC.name,
            confidence: 0.6,
            supportingActivityIds: ['x1'],
          }
        }

        return null
      },
    }

    const evaluation = await evaluateRecentActivityPatternMatcher({
      patternRepository,
      activityRepository,
      matcher,
      cooldownMs: 4 * 60 * 60 * 1000,
    })

    expect(evaluation.groundTruthTimeline).toEqual<GroundTruthSighting[]>([
      {
        sightingId: 'sighting-a1',
        patternId: 'pattern-a',
        patternName: 'Pattern A',
        startTimestamp: 1_000,
        endTimestamp: 3_000,
        activityIds: ['a1', 'a2'],
      },
      {
        sightingId: 'sighting-b1',
        patternId: 'pattern-b',
        patternName: 'Pattern B',
        startTimestamp: 5 * 60 * 60 * 1000,
        endTimestamp: 5 * 60 * 60 * 1000 + 2_000,
        activityIds: ['b1', 'b2'],
      },
    ])
    expect(evaluation.truePositives).toHaveLength(1)
    expect(evaluation.truePositives[0].groundTruth.patternId).toBe('pattern-a')
    expect(evaluation.truePositives[0].predicted.patternId).toBe('pattern-a')
    expect(evaluation.truePositives[0].detectionDelayMs).toBe(2_000)
    expect(evaluation.falseNegatives).toHaveLength(1)
    expect(evaluation.falseNegatives[0].patternId).toBe('pattern-b')
    expect(evaluation.falsePositives).toHaveLength(1)
    expect(evaluation.falsePositives[0].patternId).toBe('pattern-c')
    expect(evaluation.metrics).toEqual({
      truePositiveCount: 1,
      falseNegativeCount: 1,
      falsePositiveCount: 1,
      precision: 0.5,
      recall: 0.5,
      averageDetectionDelayMs: 2_000,
    })
  })

  it('replay passes only patterns and sightings that existed at that point in time', async () => {
    const patterns = [
      { ...makePattern('pattern-a', 'Pattern A'), createdAt: 1_000, sightingCount: 2 },
      { ...makePattern('pattern-b', 'Pattern B'), createdAt: 4_000, sightingCount: 1 },
    ]
    const sightingsByPattern = new Map<string, PatternSighting[]>([
      [
        'pattern-a',
        [
          { ...makeSighting('sighting-a1', 'pattern-a', ['a1']), detectedAt: 1_500 },
          { ...makeSighting('sighting-a2', 'pattern-a', ['a2']), detectedAt: 4_500 },
        ],
      ],
      ['pattern-b', [{ ...makeSighting('sighting-b1', 'pattern-b', ['b1']), detectedAt: 5_500 }]],
    ])
    const replayActivities = [makeStoredActivity('a1', 2_000), makeStoredActivity('a2', 5_000)]
    const calls: Array<{ patternIds: string[]; sightingIds: string[]; now: number }> = []

    const matcher: RecentActivityPatternMatcher = {
      match: async ({ patterns: activePatterns, sightings, now }) => {
        calls.push({
          patternIds: activePatterns.map((pattern) => pattern.id).sort(),
          sightingIds: sightings.map((sighting) => sighting.id).sort(),
          now,
        })
        return null
      },
    }

    await replayPatternNotifications({
      replayActivities,
      patternRepository: {
        getAllPatterns: () => patterns,
        getSightingsForPattern: (patternId) => sightingsByPattern.get(patternId) ?? [],
      } as Pick<PatternRepository, 'getAllPatterns' | 'getSightingsForPattern'>,
      matcher,
    })

    expect(calls).toEqual([
      {
        patternIds: ['pattern-a'],
        sightingIds: ['sighting-a1'],
        now: 3_000,
      },
      {
        patternIds: ['pattern-a', 'pattern-b'],
        sightingIds: ['sighting-a1', 'sighting-a2', 'sighting-b1'],
        now: 6_000,
      },
    ])
  })
})
