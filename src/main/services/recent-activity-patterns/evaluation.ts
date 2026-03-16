import type {
  ActivityRepository,
  PatternRepository,
  PatternSighting,
  PatternWithStats,
} from '../../storage'
import type { StoredActivity } from '../../storage/types'
import { NoopPatternNotificationService } from './notification-service'
import { PatternSurfaceCooldown } from './pattern-surface-cooldown'
import { PersistedActivityPatternListener } from './persisted-activity-pattern-listener'
import { RecentActivityWindow } from './recent-activity-window'
import { createReplayPatternRepository } from './replay-pattern-repository'
import type { PatternMatch, RecentActivityPatternMatcher } from './types'

export interface GroundTruthSighting {
  sightingId: string
  patternId: string
  patternName: string
  startTimestamp: number
  endTimestamp: number
  activityIds: string[]
}

export interface PredictedPatternNotification extends PatternMatch {
  notifiedAt: number
}

export interface TruePositiveMatch {
  groundTruth: GroundTruthSighting
  predicted: PredictedPatternNotification
  detectionDelayMs: number
}

export interface RecentActivityPatternEvaluation {
  groundTruthTimeline: GroundTruthSighting[]
  predictedTimeline: PredictedPatternNotification[]
  truePositives: TruePositiveMatch[]
  falseNegatives: GroundTruthSighting[]
  falsePositives: PredictedPatternNotification[]
  metrics: {
    truePositiveCount: number
    falseNegativeCount: number
    falsePositiveCount: number
    precision: number | null
    recall: number | null
    averageDetectionDelayMs: number | null
  }
}

type PatternRepoForEvaluation = Pick<PatternRepository, 'getAllPatterns' | 'getSightingsForPattern'>

type ActivityRepoForEvaluation = Pick<ActivityRepository, 'getByIds' | 'getByTimeRange'>

export function buildGroundTruthTimeline(params: {
  patternRepository: PatternRepoForEvaluation
  activityRepository: Pick<ActivityRepository, 'getByIds'>
}): GroundTruthSighting[] {
  const timeline: GroundTruthSighting[] = []

  for (const pattern of params.patternRepository.getAllPatterns()) {
    const sightings = params.patternRepository.getSightingsForPattern(
      pattern.id,
      Math.max(pattern.sightingCount, 1),
    )

    for (const sighting of sightings) {
      const entry = toGroundTruthSighting(pattern, sighting, params.activityRepository)
      if (entry) {
        timeline.push(entry)
      }
    }
  }

  return timeline.sort((a, b) => a.startTimestamp - b.startTimestamp)
}

export async function evaluateRecentActivityPatternMatcher(params: {
  patternRepository: PatternRepoForEvaluation
  activityRepository: ActivityRepoForEvaluation
  matcher: RecentActivityPatternMatcher
  cooldownMs?: number
  recentWindowSize?: number
}): Promise<RecentActivityPatternEvaluation> {
  const groundTruthTimeline = buildGroundTruthTimeline({
    patternRepository: params.patternRepository,
    activityRepository: params.activityRepository,
  })

  if (groundTruthTimeline.length === 0) {
    return {
      groundTruthTimeline,
      predictedTimeline: [],
      truePositives: [],
      falseNegatives: [],
      falsePositives: [],
      metrics: {
        truePositiveCount: 0,
        falseNegativeCount: 0,
        falsePositiveCount: 0,
        precision: null,
        recall: null,
        averageDetectionDelayMs: null,
      },
    }
  }

  const replayActivities = loadReplayActivities({
    activityRepository: params.activityRepository,
    startTimestamp: groundTruthTimeline[0].startTimestamp,
    endTimestamp: groundTruthTimeline[groundTruthTimeline.length - 1].endTimestamp,
  })

  const predictedTimeline = await replayPatternNotifications({
    replayActivities,
    patternRepository: params.patternRepository,
    matcher: params.matcher,
    cooldownMs: params.cooldownMs,
    recentWindowSize: params.recentWindowSize,
  })

  return comparePatternTimelines({ groundTruthTimeline, predictedTimeline })
}

export async function replayPatternNotifications(params: {
  replayActivities: StoredActivity[]
  patternRepository: Pick<PatternRepository, 'getAllPatterns'>
  matcher: RecentActivityPatternMatcher
  cooldownMs?: number
  recentWindowSize?: number
}): Promise<PredictedPatternNotification[]> {
  const predictedTimeline: PredictedPatternNotification[] = []
  let now = 0

  const replayPatternRepository = createReplayPatternRepository({
    patternRepository: params.patternRepository,
    now: () => now,
  })

  const listener = new PersistedActivityPatternListener({
    patternRepository: replayPatternRepository,
    matcher: params.matcher,
    notificationService: {
      ...new NoopPatternNotificationService(),
      notify: async (match) => {
        predictedTimeline.push({
          ...match,
          notifiedAt: now,
        })
      },
    },
    recentActivityWindow: new RecentActivityWindow(params.recentWindowSize),
    cooldown: new PatternSurfaceCooldown(params.cooldownMs),
    now: () => now,
  })

  for (const activity of params.replayActivities) {
    now = activity.endTimestamp
    await listener.handlePersistedActivity(toPersistedInput(activity))
  }

  return predictedTimeline
}

export function comparePatternTimelines(params: {
  groundTruthTimeline: GroundTruthSighting[]
  predictedTimeline: PredictedPatternNotification[]
}): RecentActivityPatternEvaluation {
  const matchedGroundTruth = new Set<string>()
  const truePositives: TruePositiveMatch[] = []
  const falsePositives: PredictedPatternNotification[] = []

  const groundTruthTimeline = [...params.groundTruthTimeline].sort(
    (a, b) => a.startTimestamp - b.startTimestamp,
  )
  const predictedTimeline = [...params.predictedTimeline].sort(
    (a, b) => a.notifiedAt - b.notifiedAt,
  )

  for (const predicted of predictedTimeline) {
    const match = groundTruthTimeline.find(
      (groundTruth) =>
        !matchedGroundTruth.has(groundTruth.sightingId) &&
        groundTruth.patternId === predicted.patternId &&
        predicted.notifiedAt >= groundTruth.startTimestamp &&
        predicted.notifiedAt <= groundTruth.endTimestamp,
    )

    if (!match) {
      falsePositives.push(predicted)
      continue
    }

    matchedGroundTruth.add(match.sightingId)
    truePositives.push({
      groundTruth: match,
      predicted,
      detectionDelayMs: predicted.notifiedAt - match.startTimestamp,
    })
  }

  const falseNegatives = groundTruthTimeline.filter(
    (groundTruth) => !matchedGroundTruth.has(groundTruth.sightingId),
  )

  return {
    groundTruthTimeline,
    predictedTimeline,
    truePositives,
    falseNegatives,
    falsePositives,
    metrics: buildMetrics({
      truePositiveCount: truePositives.length,
      falseNegativeCount: falseNegatives.length,
      falsePositiveCount: falsePositives.length,
      detectionDelayMs: truePositives.map((match) => match.detectionDelayMs),
    }),
  }
}

function loadReplayActivities(params: {
  activityRepository: ActivityRepoForEvaluation
  startTimestamp: number
  endTimestamp: number
}): StoredActivity[] {
  const summaryActivities = params.activityRepository.getByTimeRange(
    params.startTimestamp,
    params.endTimestamp,
  )
  const ids = summaryActivities.map((activity) => activity.id)
  const storedById = new Map(
    params.activityRepository.getByIds(ids).map((activity) => [activity.id, activity]),
  )

  return ids
    .map((id) => storedById.get(id))
    .filter((activity): activity is StoredActivity => activity !== undefined)
}

function toGroundTruthSighting(
  pattern: PatternWithStats,
  sighting: PatternSighting,
  activityRepository: Pick<ActivityRepository, 'getByIds'>,
): GroundTruthSighting | null {
  if (sighting.activityIds.length === 0) {
    return null
  }

  const activitiesById = new Map(
    activityRepository.getByIds(sighting.activityIds).map((activity) => [activity.id, activity]),
  )
  const orderedActivities = sighting.activityIds
    .map((id) => activitiesById.get(id))
    .filter((activity): activity is StoredActivity => activity !== undefined)

  if (orderedActivities.length === 0) {
    return null
  }

  if (pattern.createdAt > orderedActivities[0].startTimestamp) {
    return null
  }

  return {
    sightingId: sighting.id,
    patternId: pattern.id,
    patternName: pattern.name,
    startTimestamp: orderedActivities[0].startTimestamp,
    endTimestamp: orderedActivities[orderedActivities.length - 1].endTimestamp,
    activityIds: orderedActivities.map((activity) => activity.id),
  }
}

function toPersistedInput(activity: StoredActivity) {
  return {
    activity: {
      id: activity.id,
      startTimestamp: activity.startTimestamp,
      endTimestamp: activity.endTimestamp,
      context: {
        appName: activity.appName,
        windowTitle: activity.windowTitle,
        tld: activity.tld ?? undefined,
      },
      interactions: [],
      frames: [],
      provenance: {
        eventWindowOffsets: [],
        frameOffsets: [],
        sourceWindowIds: [],
        sourceClosedBy: [],
      },
    },
    extracted: {
      activityId: activity.id,
      startTimestamp: activity.startTimestamp,
      endTimestamp: activity.endTimestamp,
      appName: activity.appName,
      windowTitle: activity.windowTitle,
      tld: activity.tld ?? undefined,
      summary: activity.summary,
      ocrText: activity.ocrText,
      vector: activity.vector,
    },
  }
}

function buildMetrics(params: {
  truePositiveCount: number
  falseNegativeCount: number
  falsePositiveCount: number
  detectionDelayMs: number[]
}) {
  const precisionDenominator = params.truePositiveCount + params.falsePositiveCount
  const recallDenominator = params.truePositiveCount + params.falseNegativeCount
  const averageDetectionDelayMs =
    params.detectionDelayMs.length > 0
      ? Math.round(
          params.detectionDelayMs.reduce((sum, delay) => sum + delay, 0) /
            params.detectionDelayMs.length,
        )
      : null

  return {
    truePositiveCount: params.truePositiveCount,
    falseNegativeCount: params.falseNegativeCount,
    falsePositiveCount: params.falsePositiveCount,
    precision: precisionDenominator > 0 ? params.truePositiveCount / precisionDenominator : null,
    recall: recallDenominator > 0 ? params.truePositiveCount / recallDenominator : null,
    averageDetectionDelayMs,
  }
}
