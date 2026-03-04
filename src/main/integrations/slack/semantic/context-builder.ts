import type { ActivityRepository, ActivitySummary } from '../../../storage'
import type { SlackSemanticContext, SlackSemanticMessage } from './types'

const LOOKBACK_MS = 30 * 60 * 1000
const LOOKAHEAD_MS = 2 * 60 * 1000
const MAX_ACTIVITIES = 6
const MAX_SUMMARY_CHARS = 160
const MAX_WINDOW_TITLE_CHARS = 100

export class SlackContextBuilder {
  constructor(private readonly activities: ActivityRepository) {}

  public build(message: SlackSemanticMessage): SlackSemanticContext {
    const messageTimestampMs = parseSlackTsToMs(message.messageTs)
    const recentActivities = this.activities
      .getByTimeRange(messageTimestampMs - LOOKBACK_MS, messageTimestampMs + LOOKAHEAD_MS)
      .slice(-MAX_ACTIVITIES)
      .map((activity) => this.compactActivity(activity))

    return {
      message,
      messageTimestampMs,
      activities: recentActivities,
    }
  }

  private compactActivity(activity: ActivitySummary): ActivitySummary {
    return {
      ...activity,
      summary: clip(activity.summary, MAX_SUMMARY_CHARS),
      windowTitle: clip(activity.windowTitle, MAX_WINDOW_TITLE_CHARS),
    }
  }
}

export function parseSlackTsToMs(ts: string): number {
  const parsed = Number.parseFloat(ts)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid Slack timestamp: ${ts}`)
  }
  return Math.round(parsed * 1000)
}

export function formatActivitiesForPrompt(activities: ActivitySummary[]): string {
  if (activities.length === 0) {
    return '- none'
  }

  return activities
    .map((activity) => {
      const parts = [
        new Date(activity.startTimestamp).toISOString(),
        activity.appName || 'Unknown',
        activity.windowTitle ? JSON.stringify(activity.windowTitle) : null,
        activity.summary || '(no summary)',
      ].filter(Boolean)
      return `- ${parts.join(' | ')}`
    })
    .join('\n')
}

function clip(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) {
    return normalized
  }
  return `${normalized.slice(0, maxChars - 3)}...`
}
