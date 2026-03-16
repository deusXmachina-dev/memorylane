import type { PatternWithStats } from '../../storage'
import type { PatternMatch, RecentActivityPatternMatcher, RecentPatternActivity } from './types'

export class NullRecentActivityPatternMatcher implements RecentActivityPatternMatcher {
  async match(input: {
    recentActivities: RecentPatternActivity[]
    patterns: PatternWithStats[]
    now: number
  }): Promise<PatternMatch | null> {
    void input
    return null
  }
}
