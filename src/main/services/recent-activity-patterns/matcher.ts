import type { PatternSighting, PatternWithStats } from '../../storage'
import type { PatternMatch, RecentActivityPatternMatcher, RecentPatternActivity } from './types'

export class NullRecentActivityPatternMatcher implements RecentActivityPatternMatcher {
  async match(input: {
    recentActivities: RecentPatternActivity[]
    patterns: PatternWithStats[]
    sightings: PatternSighting[]
    now: number
  }): Promise<PatternMatch | null> {
    void input
    return null
  }
}
