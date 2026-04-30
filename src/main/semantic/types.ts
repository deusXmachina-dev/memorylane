import type { ActivityFrame } from '../activity-types'
import type { ProviderResolver } from '../llm'

export type SemanticMode = 'video' | 'snapshot'
export type SemanticPipelinePreference = 'auto' | 'video' | 'image'

export type ChatContentItem =
  | { type: 'text'; text: string }
  | { type: 'input_video'; videoUrl: { url: string } }
  | { type: 'image_url'; imageUrl: { url: string; detail: 'high' } }

export interface ChatRequest {
  model: string
  messages: Array<{
    role: 'user'
    content: ChatContentItem[]
  }>
}

export interface SemanticChatClient {
  chat: {
    send(request: ChatRequest): Promise<unknown>
  }
}

export interface ChatResponseLike {
  choices?: Array<{
    message?: {
      content?: unknown
    }
  }>
  usage?: {
    promptTokens?: number
    completionTokens?: number
    prompt_tokens?: number
    completion_tokens?: number
  }
}

export interface UsageTrackerLike {
  recordUsage(usage: { prompt_tokens: number; completion_tokens: number; cost?: number }): void
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
  client?: SemanticChatClient
  resolver?: ProviderResolver
  debugDumper?: SemanticDebugDumper
}

export interface SemanticAttempt {
  mode: SemanticMode
  model: string
  durationMs: number
  success: boolean
  error?: string
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

export interface SemanticRoundTripDump {
  activityId: string
  mode: SemanticMode
  model: string
  startedAt: number
  durationMs: number
  success: boolean
  request: ChatRequest
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
