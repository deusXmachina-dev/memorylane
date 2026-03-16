import type { PatternSighting, PatternWithStats } from '../../storage'

export interface RecentPatternActivity {
  id: string
  startTimestamp: number
  endTimestamp: number
  appName: string
  windowTitle: string
  tld: string | null
  summary: string
  ocrText: string
}

export interface PatternMatch {
  patternId: string
  patternName: string
  confidence: number
  reason?: string
  supportingActivityIds: string[]
}

export interface RecentActivityPatternMatcher {
  match(input: {
    recentActivities: RecentPatternActivity[]
    patterns: PatternWithStats[]
    sightings: PatternSighting[]
    now: number
  }): Promise<PatternMatch | null>
}

export interface PatternNotificationService {
  notify(match: PatternMatch): Promise<void>
}
