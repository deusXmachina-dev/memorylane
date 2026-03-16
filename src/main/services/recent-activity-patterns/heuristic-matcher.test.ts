import { describe, expect, it } from 'vitest'
import type { ActivityRepository, PatternSighting, PatternWithStats } from '../../storage'
import type { StoredActivity } from '../../storage/types'
import { HeuristicRecentActivityPatternMatcher } from './heuristic-matcher'
import type { RecentPatternActivity } from './types'

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
    sightingCount: 1,
    lastSeenAt: 2_000,
    lastConfidence: 0.8,
  }
}

function makeSighting(id: string, patternId: string, activityIds: string[]): PatternSighting {
  return {
    id,
    patternId,
    detectedAt: 2_000,
    runId: 'run-1',
    evidence: '',
    activityIds,
    confidence: 0.9,
    durationEstimateMin: null,
  }
}

function makeStoredActivity(id: string, appName: string, summary: string): StoredActivity {
  return {
    id,
    startTimestamp: 1_000,
    endTimestamp: 2_000,
    appName,
    windowTitle: `${appName} Window`,
    tld: 'github.com',
    summary,
    ocrText: summary,
    vector: [0.1, 0.2, 0.3],
  }
}

function makeRecentActivity(id: string, appName: string, summary: string): RecentPatternActivity {
  return {
    id,
    startTimestamp: 1_000,
    endTimestamp: 2_000,
    appName,
    windowTitle: `${appName} Window`,
    tld: 'github.com',
    summary,
    ocrText: summary,
  }
}

describe('HeuristicRecentActivityPatternMatcher', () => {
  it('matches recent activities against similar historical sightings', async () => {
    const activityRepository: Pick<ActivityRepository, 'getByIds'> = {
      getByIds: (ids) =>
        ids
          .map((id) => activityMap.get(id))
          .filter((activity): activity is StoredActivity => activity !== undefined),
    } as Pick<ActivityRepository, 'getByIds'>
    const matcher = new HeuristicRecentActivityPatternMatcher(activityRepository)
    const pattern = makePattern('pattern-1', 'Release verification')
    const activityMap = new Map<string, StoredActivity>([
      ['h1', makeStoredActivity('h1', 'Code', 'review release build logs')],
      ['h2', makeStoredActivity('h2', 'Code', 'review release build logs')],
      ['o1', makeStoredActivity('o1', 'Safari', 'browse unrelated page')],
    ])

    const match = await matcher.match({
      recentActivities: [
        makeRecentActivity('r1', 'Code', 'review release build logs'),
        makeRecentActivity('r2', 'Code', 'review release build logs'),
      ],
      patterns: [pattern],
      sightings: [
        makeSighting('s1', 'pattern-1', ['h1', 'h2']),
        makeSighting('s2', 'pattern-1', ['o1']),
      ],
      now: 5_000,
    })

    expect(match).toEqual(
      expect.objectContaining({
        patternId: 'pattern-1',
        patternName: 'Release verification',
      }),
    )
    expect(match?.confidence).toBeGreaterThanOrEqual(0.72)
  })

  it('returns null when there is no strong historical similarity', async () => {
    const activityRepository: Pick<ActivityRepository, 'getByIds'> = {
      getByIds: (ids) =>
        ids
          .map((id) => activityMap.get(id))
          .filter((activity): activity is StoredActivity => activity !== undefined),
    } as Pick<ActivityRepository, 'getByIds'>
    const matcher = new HeuristicRecentActivityPatternMatcher(activityRepository)
    const pattern = makePattern('pattern-1', 'Release verification')
    const activityMap = new Map<string, StoredActivity>([
      ['h1', makeStoredActivity('h1', 'Terminal', 'watch system resources and cpu usage')],
    ])

    const match = await matcher.match({
      recentActivities: [makeRecentActivity('r1', 'Safari', 'research movie showtimes nearby')],
      patterns: [pattern],
      sightings: [makeSighting('s1', 'pattern-1', ['h1'])],
      now: 5_000,
    })

    expect(match).toBeNull()
  })
})
