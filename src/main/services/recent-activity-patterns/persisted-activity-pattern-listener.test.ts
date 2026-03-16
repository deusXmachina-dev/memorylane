import { describe, expect, it, vi } from 'vitest'
import type { ActivityPersistedListenerInput } from '../../activity-extraction-types'
import type { Activity } from '../../activity-types'
import type { PatternRepository, PatternSighting, PatternWithStats } from '../../storage'
import { NullRecentActivityPatternMatcher } from './matcher'
import { PatternSurfaceCooldown } from './pattern-surface-cooldown'
import { PersistedActivityPatternListener } from './persisted-activity-pattern-listener'
import { RecentActivityWindow } from './recent-activity-window'
import type {
  PatternMatch,
  PatternNotificationService,
  RecentActivityPatternMatcher,
} from './types'

function makePersistedInput(id: string, timestamp: number): ActivityPersistedListenerInput {
  const activity: Activity = {
    id,
    startTimestamp: timestamp,
    endTimestamp: timestamp + 60_000,
    context: {
      appName: 'Code',
      bundleId: 'com.microsoft.VSCode',
      windowTitle: `Editor ${id}`,
      tld: 'github.com',
    },
    interactions: [],
    frames: [],
    provenance: {
      eventWindowOffsets: [],
      frameOffsets: [],
      sourceWindowIds: [],
      sourceClosedBy: [],
    },
  }

  return {
    activity,
    extracted: {
      activityId: id,
      startTimestamp: activity.startTimestamp,
      endTimestamp: activity.endTimestamp,
      appName: 'Code',
      windowTitle: `Editor ${id}`,
      tld: 'github.com',
      summary: `summary:${id}`,
      ocrText: `ocr:${id}`,
      vector: [0.1, 0.2, 0.3],
    },
  }
}

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
    sightingCount: 3,
    lastSeenAt: 2_000,
    lastConfidence: 0.8,
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

describe('PersistedActivityPatternListener', () => {
  it('null matcher returns null', async () => {
    const matcher = new NullRecentActivityPatternMatcher()
    await expect(
      matcher.match({
        recentActivities: [],
        patterns: [],
        sightings: [],
        now: 1_000,
      }),
    ).resolves.toBeNull()
  })

  it('calls matcher with the recent rolling window and current patterns', async () => {
    const patterns = [makePattern('pattern-1', 'Daily review')]
    const sightings = [makeSighting('sighting-1', 'pattern-1', ['a1'])]
    const matcher: RecentActivityPatternMatcher = {
      match: vi.fn().mockResolvedValue(null),
    }
    const notifier: PatternNotificationService = {
      notify: vi.fn().mockResolvedValue(undefined),
    }
    const listener = new PersistedActivityPatternListener({
      patternRepository: {
        getAllPatterns: vi.fn(() => patterns),
        getSightingsForPattern: vi.fn(() => sightings),
      } as Pick<PatternRepository, 'getAllPatterns' | 'getSightingsForPattern'>,
      matcher,
      notificationService: notifier,
      recentActivityWindow: new RecentActivityWindow(2),
      now: () => 10_000,
    })

    await listener.handlePersistedActivity(makePersistedInput('a1', 1_000))
    await listener.handlePersistedActivity(makePersistedInput('a2', 2_000))
    await listener.handlePersistedActivity(makePersistedInput('a3', 3_000))

    expect(matcher.match).toHaveBeenCalledTimes(3)
    expect(matcher.match).toHaveBeenLastCalledWith({
      recentActivities: [
        expect.objectContaining({ id: 'a2', summary: 'summary:a2' }),
        expect.objectContaining({ id: 'a3', summary: 'summary:a3' }),
      ],
      patterns,
      sightings,
      now: 10_000,
    })
    expect(notifier.notify).not.toHaveBeenCalled()
  })

  it('does not notify when matcher returns null', async () => {
    const matcher: RecentActivityPatternMatcher = {
      match: vi.fn().mockResolvedValue(null),
    }
    const notifier: PatternNotificationService = {
      notify: vi.fn().mockResolvedValue(undefined),
    }
    const listener = new PersistedActivityPatternListener({
      patternRepository: {
        getAllPatterns: vi.fn(() => [makePattern('pattern-1', 'Daily review')]),
        getSightingsForPattern: vi.fn(() => [makeSighting('sighting-1', 'pattern-1', ['a1'])]),
      } as Pick<PatternRepository, 'getAllPatterns' | 'getSightingsForPattern'>,
      matcher,
      notificationService: notifier,
    })

    await listener.handlePersistedActivity(makePersistedInput('a1', 1_000))

    expect(notifier.notify).not.toHaveBeenCalled()
  })

  it('notifies when matcher returns a match', async () => {
    const match: PatternMatch = {
      patternId: 'pattern-1',
      patternName: 'Daily review',
      confidence: 0.91,
      supportingActivityIds: ['a1'],
    }
    const matcher: RecentActivityPatternMatcher = {
      match: vi.fn().mockResolvedValue(match),
    }
    const notifier: PatternNotificationService = {
      notify: vi.fn().mockResolvedValue(undefined),
    }
    const listener = new PersistedActivityPatternListener({
      patternRepository: {
        getAllPatterns: vi.fn(() => [makePattern('pattern-1', 'Daily review')]),
        getSightingsForPattern: vi.fn(() => [makeSighting('sighting-1', 'pattern-1', ['a1'])]),
      } as Pick<PatternRepository, 'getAllPatterns' | 'getSightingsForPattern'>,
      matcher,
      notificationService: notifier,
    })

    await listener.handlePersistedActivity(makePersistedInput('a1', 1_000))

    expect(notifier.notify).toHaveBeenCalledTimes(1)
    expect(notifier.notify).toHaveBeenCalledWith(match)
  })

  it('suppresses repeated surfaces within the cooldown window', async () => {
    let now = 10_000
    const match: PatternMatch = {
      patternId: 'pattern-1',
      patternName: 'Daily review',
      confidence: 0.91,
      supportingActivityIds: ['a1'],
    }
    const matcher: RecentActivityPatternMatcher = {
      match: vi.fn().mockResolvedValue(match),
    }
    const notifier: PatternNotificationService = {
      notify: vi.fn().mockResolvedValue(undefined),
    }
    const listener = new PersistedActivityPatternListener({
      patternRepository: {
        getAllPatterns: vi.fn(() => [makePattern('pattern-1', 'Daily review')]),
        getSightingsForPattern: vi.fn(() => [makeSighting('sighting-1', 'pattern-1', ['a1'])]),
      } as Pick<PatternRepository, 'getAllPatterns' | 'getSightingsForPattern'>,
      matcher,
      notificationService: notifier,
      cooldown: new PatternSurfaceCooldown(4 * 60 * 60 * 1000),
      now: () => now,
    })

    await listener.handlePersistedActivity(makePersistedInput('a1', 1_000))
    now += 60_000
    await listener.handlePersistedActivity(makePersistedInput('a2', 2_000))

    expect(notifier.notify).toHaveBeenCalledTimes(1)
  })

  it('notifies again after the cooldown window expires', async () => {
    let now = 10_000
    const match: PatternMatch = {
      patternId: 'pattern-1',
      patternName: 'Daily review',
      confidence: 0.91,
      supportingActivityIds: ['a1'],
    }
    const matcher: RecentActivityPatternMatcher = {
      match: vi.fn().mockResolvedValue(match),
    }
    const notifier: PatternNotificationService = {
      notify: vi.fn().mockResolvedValue(undefined),
    }
    const listener = new PersistedActivityPatternListener({
      patternRepository: {
        getAllPatterns: vi.fn(() => [makePattern('pattern-1', 'Daily review')]),
        getSightingsForPattern: vi.fn(() => [makeSighting('sighting-1', 'pattern-1', ['a1'])]),
      } as Pick<PatternRepository, 'getAllPatterns' | 'getSightingsForPattern'>,
      matcher,
      notificationService: notifier,
      cooldown: new PatternSurfaceCooldown(4 * 60 * 60 * 1000),
      now: () => now,
    })

    await listener.handlePersistedActivity(makePersistedInput('a1', 1_000))
    now += 4 * 60 * 60 * 1000 + 1
    await listener.handlePersistedActivity(makePersistedInput('a2', 2_000))

    expect(notifier.notify).toHaveBeenCalledTimes(2)
  })
})
