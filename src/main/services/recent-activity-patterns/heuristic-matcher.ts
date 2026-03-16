import type { ActivityRepository, PatternSighting, PatternWithStats } from '../../storage'
import type { StoredActivity } from '../../storage/types'
import type { PatternMatch, RecentActivityPatternMatcher, RecentPatternActivity } from './types'

const MIN_CONFIDENCE = 0.75
const MAX_EXEMPLAR_ACTIVITIES = 8
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'into',
  'your',
  'have',
  'has',
  'was',
  'are',
  'not',
  'you',
  'but',
  'all',
  'out',
  'use',
  'using',
  'check',
  'manual',
])

interface ActivityFingerprint {
  id: string
  appName: string
  tld: string | null
  titleTokens: Set<string>
  summaryTokens: Set<string>
}

interface SightingExample {
  sighting: PatternSighting
  pattern: PatternWithStats
  activities: ActivityFingerprint[]
}

export class HeuristicRecentActivityPatternMatcher implements RecentActivityPatternMatcher {
  private readonly activityRepository: Pick<ActivityRepository, 'getByIds'>
  private readonly exampleCache = new Map<string, SightingExample | null>()

  constructor(activityRepository: Pick<ActivityRepository, 'getByIds'>) {
    this.activityRepository = activityRepository
  }

  async match(input: {
    recentActivities: RecentPatternActivity[]
    patterns: PatternWithStats[]
    sightings: PatternSighting[]
    now: number
  }): Promise<PatternMatch | null> {
    void input.now

    if (
      input.recentActivities.length === 0 ||
      input.patterns.length === 0 ||
      input.sightings.length === 0
    ) {
      return null
    }

    const recentFingerprints = buildRecentFingerprints(input.recentActivities)
    const patternsById = new Map(input.patterns.map((pattern) => [pattern.id, pattern]))

    let bestMatch: {
      pattern: PatternWithStats
      sighting: PatternSighting
      confidence: number
      supportingActivityIds: string[]
      reason: string
    } | null = null

    for (const sighting of input.sightings) {
      const pattern = patternsById.get(sighting.patternId)
      if (!pattern) continue

      const example = this.getOrCreateExample(sighting, pattern)
      if (!example) continue

      const score = scoreRecentAgainstExample(recentFingerprints, example.activities)
      if (score.confidence < MIN_CONFIDENCE) continue

      if (!bestMatch || score.confidence > bestMatch.confidence) {
        bestMatch = {
          pattern,
          sighting,
          confidence: score.confidence,
          supportingActivityIds: score.supportingActivityIds,
          reason: `best historical sighting: ${sighting.id}`,
        }
      }
    }

    if (!bestMatch) {
      return null
    }

    return {
      patternId: bestMatch.pattern.id,
      patternName: bestMatch.pattern.name,
      confidence: bestMatch.confidence,
      supportingActivityIds: bestMatch.supportingActivityIds,
      reason: bestMatch.reason,
    }
  }

  private getOrCreateExample(
    sighting: PatternSighting,
    pattern: PatternWithStats,
  ): SightingExample | null {
    const cached = this.exampleCache.get(sighting.id)
    if (cached !== undefined) {
      return cached
    }

    const activitiesById = new Map(
      this.activityRepository
        .getByIds(sighting.activityIds)
        .map((activity) => [activity.id, activity]),
    )
    const orderedActivities = sighting.activityIds
      .map((id) => activitiesById.get(id))
      .filter((activity): activity is StoredActivity => activity !== undefined)
      .sort((a, b) => a.startTimestamp - b.startTimestamp)
      .slice(-MAX_EXEMPLAR_ACTIVITIES)

    if (orderedActivities.length === 0) {
      this.exampleCache.set(sighting.id, null)
      return null
    }

    const example: SightingExample = {
      sighting,
      pattern,
      activities: orderedActivities.map(toActivityFingerprint),
    }
    this.exampleCache.set(sighting.id, example)
    return example
  }
}

function buildRecentFingerprints(activities: RecentPatternActivity[]): ActivityFingerprint[] {
  return activities.slice(-MAX_EXEMPLAR_ACTIVITIES).map((activity) => ({
    id: activity.id,
    appName: activity.appName,
    tld: activity.tld,
    titleTokens: tokenize(activity.windowTitle),
    summaryTokens: tokenize(activity.summary),
  }))
}

function toActivityFingerprint(activity: StoredActivity): ActivityFingerprint {
  return {
    id: activity.id,
    appName: activity.appName,
    tld: activity.tld,
    titleTokens: tokenize(activity.windowTitle),
    summaryTokens: tokenize(activity.summary),
  }
}

function scoreRecentAgainstExample(
  recentActivities: ActivityFingerprint[],
  exampleActivities: ActivityFingerprint[],
): { confidence: number; supportingActivityIds: string[] } {
  if (recentActivities.length === 0 || exampleActivities.length === 0) {
    return { confidence: 0, supportingActivityIds: [] }
  }

  const recentBestScores = recentActivities.map((recentActivity, index) => ({
    index,
    score: Math.max(
      ...exampleActivities.map((exampleActivity) =>
        scoreActivityPair(recentActivity, exampleActivity),
      ),
    ),
  }))
  recentBestScores.sort((a, b) => b.score - a.score)

  const bestSingle = recentBestScores[0]?.score ?? 0
  const topTwo = recentBestScores.slice(0, 2)
  const topTwoAverage =
    topTwo.length > 0 ? topTwo.reduce((sum, item) => sum + item.score, 0) / topTwo.length : 0
  const solidHitCount = recentBestScores.filter((item) => item.score >= 0.68).length

  const aggregateScore = scoreAggregateOverlap(recentActivities, exampleActivities)
  const confidence = roundScore(
    Math.max(
      bestSingle * 0.7 + aggregateScore * 0.3,
      topTwoAverage * 0.75 + Math.min(solidHitCount, 2) * 0.08,
    ),
  )

  return {
    confidence,
    supportingActivityIds: recentBestScores
      .filter((item) => item.score >= 0.68)
      .slice(0, 3)
      .map((item) => recentActivities[item.index].id),
  }
}

function scoreActivityPair(a: ActivityFingerprint, b: ActivityFingerprint): number {
  const appScore = a.appName === b.appName ? 1 : 0
  const tldScore = a.tld !== null && b.tld !== null && a.tld === b.tld ? 1 : 0
  const titleScore = jaccard(a.titleTokens, b.titleTokens)
  const summaryScore = jaccard(a.summaryTokens, b.summaryTokens)

  return appScore * 0.5 + titleScore * 0.2 + summaryScore * 0.25 + tldScore * 0.05
}

function scoreAggregateOverlap(
  recentActivities: ActivityFingerprint[],
  exampleActivities: ActivityFingerprint[],
): number {
  const recentApps = new Set(recentActivities.map((activity) => activity.appName))
  const exampleApps = new Set(exampleActivities.map((activity) => activity.appName))
  const recentTlds = new Set(recentActivities.map((activity) => activity.tld).filter(Boolean))
  const exampleTlds = new Set(exampleActivities.map((activity) => activity.tld).filter(Boolean))
  const recentSummaryTokens = unionSets(recentActivities.map((activity) => activity.summaryTokens))
  const exampleSummaryTokens = unionSets(
    exampleActivities.map((activity) => activity.summaryTokens),
  )

  const appScore = jaccard(recentApps, exampleApps)
  const tldScore = jaccard(recentTlds, exampleTlds)
  const summaryScore = jaccard(recentSummaryTokens, exampleSummaryTokens)

  return appScore * 0.5 + tldScore * 0.2 + summaryScore * 0.3
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  )
}

function unionSets(sets: Array<Set<string>>): Set<string> {
  const union = new Set<string>()
  for (const current of sets) {
    for (const value of current) {
      union.add(value)
    }
  }
  return union
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0

  let intersection = 0
  for (const value of a) {
    if (b.has(value)) {
      intersection++
    }
  }

  const union = a.size + b.size - intersection
  return union > 0 ? intersection / union : 0
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000
}
