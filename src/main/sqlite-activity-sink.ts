import type { ActivityRepository } from './storage/activity-repository'
import type { ActivitySink, ExtractedActivity } from './activity-extraction-types'
import type { Activity } from './activity-types'

export class SqliteActivitySink implements ActivitySink {
  private readonly repo: ActivityRepository

  constructor(repo: ActivityRepository) {
    this.repo = repo
  }

  async persist(input: { activity: Activity; extracted: ExtractedActivity }): Promise<void> {
    const { activity, extracted } = input
    if (extracted.activityId !== activity.id) {
      throw new Error(
        `[SqliteActivitySink] activityId mismatch: activity.id=${activity.id}, extracted.activityId=${extracted.activityId}`,
      )
    }

    try {
      this.repo.add({
        id: extracted.activityId,
        startTimestamp: extracted.startTimestamp,
        endTimestamp: extracted.endTimestamp,
        appName: extracted.appName,
        windowTitle: extracted.windowTitle,
        tld: extracted.tld ?? null,
        summary: extracted.summary,
        summaryModel: extracted.summaryModel,
        summaryMode: extracted.summaryMode,
        summaryReason: extracted.summaryReason,
        summaryFailureDetail: extracted.summaryFailureDetail,
        ocrText: extracted.ocrText,
        vector: extracted.vector,
      })
    } catch (error) {
      if (this.isDuplicateActivityIdError(error)) {
        return
      }
      throw error
    }
  }

  private isDuplicateActivityIdError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    return error.message.includes('UNIQUE constraint failed: activities.id')
  }
}
