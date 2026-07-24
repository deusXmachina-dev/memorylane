import type { Activity } from './activity-types'

export interface ExtractedActivity {
  activityId: string
  startTimestamp: number
  endTimestamp: number
  appName: string
  windowTitle: string
  tld?: string
  summary: string
  summaryModel: string
  ocrText: string
  vector: number[]
}

export interface ActivityPersistedListenerInput {
  activity: Activity
  extracted: ExtractedActivity
}

export type ActivityPersistedListener = (
  input: ActivityPersistedListenerInput,
) => void | Promise<void>

export interface ActivityTransformer {
  transform(activity: Activity): Promise<ExtractedActivity>
}

export interface ActivitySink {
  persist(input: { activity: Activity; extracted: ExtractedActivity }): Promise<void>
}

export interface ActivityExtractorConfig {
  consumerId: string
  maxConcurrent: number
  maxRetries: number
  retryBackoffMs: number
  onTaskComplete?: (activity: Activity, outcome: 'succeeded' | 'dead-lettered') => void
  /** When false, dispatch is held: tasks queue unprocessed and unacked until kick(). */
  isReady?: () => boolean
}

export interface ActivityExtractorStats {
  queued: number
  inFlight: number
  succeeded: number
  failed: number
  retried: number
  deadLettered: number
  ackedOffset: number | null
}

export const DEFAULT_ACTIVITY_EXTRACTOR_CONFIG: ActivityExtractorConfig = {
  consumerId: 'activity-extractor:activity-stream',
  maxConcurrent: 1,
  maxRetries: 2,
  retryBackoffMs: 100,
}
