import type { RecentPatternActivity } from './types'

export class RecentActivityWindow {
  private readonly activities: RecentPatternActivity[] = []
  private readonly maxActivities: number

  constructor(maxActivities = 8) {
    if (!Number.isInteger(maxActivities) || maxActivities <= 0) {
      throw new Error('maxActivities must be a positive integer')
    }
    this.maxActivities = maxActivities
  }

  append(activity: RecentPatternActivity): void {
    this.activities.push(activity)
    const overflow = this.activities.length - this.maxActivities
    if (overflow > 0) {
      this.activities.splice(0, overflow)
    }
  }

  snapshot(): RecentPatternActivity[] {
    return [...this.activities]
  }
}
