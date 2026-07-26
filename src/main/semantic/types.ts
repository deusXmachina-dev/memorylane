import type { ActivityFrame } from '@main/activity/activity-types'
import type { SummaryOutcome } from './summary-reason'

export type SemanticMode = 'video' | 'snapshot'
export type SemanticPipelinePreference = 'auto' | 'video' | 'image'

export type ChatContentItem =
  | { type: 'text'; text: string }
  | { type: 'input_video'; videoUrl: { url: string } }
  | { type: 'image_url'; imageUrl: { url: string; detail: 'high' } }

export interface UsageTrackerLike {
  recordUsage(usage: { prompt_tokens: number; completion_tokens: number; cost?: number }): void
}

export interface SummaryModeTrackerLike {
  record(outcome: SummaryOutcome): void
}

export interface EncodedImage {
  frame: ActivityFrame
  dataUrl: string
}

export interface AttemptResult {
  summary: string
  model: string
}

export interface VideoAssetData {
  dataUrl: string
  sizeBytes: number
  mimeType: string
}

export interface ActivitySemanticServiceConfig {
  videoModels?: string[]
  snapshotModels?: string[]
  pipelinePreference?: SemanticPipelinePreference
  maxVideoBytes?: number
  requestTimeoutMs?: number
  usageTracker?: UsageTrackerLike
  summaryModeTracker?: SummaryModeTrackerLike
  debugDumper?: SemanticDebugDumper
  /**
   * Optional fetch override used by the raw-HTTP video pipeline. Mostly for
   * tests; production uses globalThis.fetch.
   */
  fetchImpl?: typeof globalThis.fetch
  /**
   * File path for persisting LLM health across restarts, so the status panel
   * shows the genuine last-known state on launch instead of an unverified
   * `unknown`. Omit (e.g. in tests) to keep health in-memory only.
   */
  healthStatePath?: string
}

export interface SemanticAttempt {
  mode: SemanticMode
  model: string
  durationMs: number
  success: boolean
  error?: string
  /** HTTP status of a failed attempt, when available (null for network/timeout). */
  httpStatus?: number | null
  promptTokens?: number
  completionTokens?: number
}

export interface SemanticRunDiagnostics {
  activityId: string
  pipelinePreference: SemanticPipelinePreference
  promptChars: number
  chosenMode: SemanticMode | null
  chosenModel: string | null
  fallbackReason: string | null
  attempts: SemanticAttempt[]
  selectedSnapshotPaths: string[]
  videoSizeBytes: number | null
  videoMimeType: string | null
}

export interface SemanticDumpRequest {
  model: string
  messages: Array<{
    role: 'user'
    content: ChatContentItem[]
  }>
}

export interface SemanticRoundTripDump {
  activityId: string
  mode: SemanticMode
  model: string
  startedAt: number
  durationMs: number
  success: boolean
  request: SemanticDumpRequest
  requestJson: string
  responseJson?: string
  summary?: string
  error?: string
}

export interface SemanticDebugDumper {
  dumpRoundTrip(input: SemanticRoundTripDump): void
}

export interface LlmHealthStatus {
  configured: boolean
  state: 'not_configured' | 'unknown' | 'active' | 'failing'
  consecutiveFailures: number
  lastError: string | null
  lastAttemptAt: number | null
}
