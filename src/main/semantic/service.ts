import { ACTIVITY_CONFIG, VISUAL_DETECTOR_CONFIG } from '@constants'
import log from '../logger'
import { UsageTracker } from '../services/usage-tracker'
import type { Activity } from '../activity-types'
import type { ActivitySemanticService as SemanticServiceContract } from '../activity-transformer-types'
import { getCapabilities, type ProviderResolver } from '../llm'
import { DEFAULT_SNAPSHOT_MODELS, DEFAULT_VIDEO_MODELS } from './constants'
import { createAISDKChatClient } from './ai-sdk-client'
import { tryLoadVideoAsDataUrl, encodeSnapshots } from './media'
import { trySemanticModelChain } from './model-chain'
import { buildSemanticPrompt } from './prompt'
import { describeSemanticError, extractSemanticSummary } from './response-utils'
import { selectSnapshotFrames } from './sampling'
import { recordSemanticUsageSafe } from './usage-recording'
import type {
  ChatContentItem,
  ChatRequest,
  ChatResponseLike,
  LlmHealthStatus,
  SemanticMode,
  SemanticPipelinePreference,
  SemanticChatClient,
  ActivitySemanticServiceConfig,
  SemanticRunDiagnostics,
} from './types'

export class ActivitySemanticService implements SemanticServiceContract {
  private client: SemanticChatClient | null = null
  private videoModels: string[]
  private snapshotModels: string[]
  private readonly maxVideoBytes: number
  private requestTimeoutMs: number
  private pipelinePreference: SemanticPipelinePreference
  private readonly usageTracker: ActivitySemanticServiceConfig['usageTracker']
  private readonly debugDumper: ActivitySemanticServiceConfig['debugDumper']
  private readonly usesInjectedClient: boolean
  private readonly resolver: ProviderResolver | null

  private userContextGetter: (() => string | null) | null = null
  private lastRunDiagnostics: SemanticRunDiagnostics | null = null
  private llmHealth: {
    consecutiveFailures: number
    lastError: string | null
    lastAttemptAt: number | null
    lastSuccessAt: number | null
  } = {
    consecutiveFailures: 0,
    lastError: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
  }
  private connectionTestPromise: Promise<void> | null = null

  constructor(config?: ActivitySemanticServiceConfig) {
    this.videoModels = config?.videoModels?.length
      ? [...config.videoModels]
      : [...DEFAULT_VIDEO_MODELS]
    this.snapshotModels = config?.snapshotModels?.length
      ? [...config.snapshotModels]
      : [...DEFAULT_SNAPSHOT_MODELS]
    this.maxVideoBytes = config?.maxVideoBytes ?? 25 * 1024 * 1024
    this.requestTimeoutMs = config?.requestTimeoutMs ?? ACTIVITY_CONFIG.SEMANTIC_REQUEST_TIMEOUT_MS
    this.pipelinePreference = this.normalizePipelinePreference(config?.pipelinePreference)
    this.usageTracker = config?.usageTracker ?? new UsageTracker()
    this.debugDumper = config?.debugDumper

    if (!Number.isFinite(this.maxVideoBytes) || this.maxVideoBytes <= 0) {
      throw new Error('maxVideoBytes must be > 0')
    }
    this.assertValidRequestTimeoutMs(this.requestTimeoutMs)

    this.usesInjectedClient = Boolean(config?.client)
    this.resolver = config?.resolver ?? null

    if (config?.client) {
      this.client = config.client
    } else if (this.resolver) {
      this.client = createAISDKChatClient(this.resolver)
    } else {
      this.client = null
      log.warn(
        '[ActivitySemanticService] No client/resolver configured - semantic summarization disabled',
      )
    }
  }

  isConfigured(): boolean {
    return this.client !== null && this.hasActiveProvider()
  }

  setUserContext(getter: (() => string | null) | null): void {
    this.userContextGetter = getter
  }

  getLlmHealthStatus(): LlmHealthStatus {
    const configured = this.isConfigured()
    if (!configured) {
      return {
        configured: false,
        state: 'not_configured',
        consecutiveFailures: 0,
        lastError: null,
        lastAttemptAt: this.llmHealth.lastAttemptAt,
      }
    }

    if (this.llmHealth.consecutiveFailures > 0) {
      return {
        configured: true,
        state: 'failing',
        consecutiveFailures: this.llmHealth.consecutiveFailures,
        lastError: this.llmHealth.lastError,
        lastAttemptAt: this.llmHealth.lastAttemptAt,
      }
    }

    if (this.llmHealth.lastSuccessAt !== null) {
      return {
        configured: true,
        state: 'active',
        consecutiveFailures: 0,
        lastError: null,
        lastAttemptAt: this.llmHealth.lastAttemptAt,
      }
    }

    return {
      configured: true,
      state: 'unknown',
      consecutiveFailures: 0,
      lastError: null,
      lastAttemptAt: this.llmHealth.lastAttemptAt,
    }
  }

  /**
   * Reset health state. Call after the active provider changes so probes/tests
   * start from a clean slate against the new provider.
   */
  refresh(): void {
    this.resetLlmHealth()
  }

  async testConnection(): Promise<void> {
    if (!this.client || !this.hasActiveProvider()) {
      this.resetLlmHealth()
      return
    }

    if (this.connectionTestPromise) {
      return this.connectionTestPromise
    }

    this.connectionTestPromise = this.runConnectionTest().finally(() => {
      this.connectionTestPromise = null
    })

    return this.connectionTestPromise
  }

  updateModels(videoModels: string[], snapshotModels: string[]): void {
    this.videoModels = videoModels.length > 0 ? [...videoModels] : [...DEFAULT_VIDEO_MODELS]
    this.snapshotModels =
      snapshotModels.length > 0 ? [...snapshotModels] : [...DEFAULT_SNAPSHOT_MODELS]
    log.info(
      '[ActivitySemanticService] Models updated',
      JSON.stringify({ videoModels: this.videoModels, snapshotModels: this.snapshotModels }),
    )
  }

  updatePipelinePreference(preference: SemanticPipelinePreference): void {
    this.pipelinePreference = this.normalizePipelinePreference(preference)
  }

  updateRequestTimeoutMs(timeoutMs: number): void {
    this.assertValidRequestTimeoutMs(timeoutMs)
    this.requestTimeoutMs = timeoutMs
  }

  getPipelinePreference(): SemanticPipelinePreference {
    return this.pipelinePreference
  }

  async summarizeFromVideo(input: { activity: Activity; videoPath?: string }): Promise<string> {
    this.assertInput(input)

    const diagnostics: SemanticRunDiagnostics = {
      activityId: input.activity.id,
      pipelinePreference: this.pipelinePreference,
      promptChars: 0,
      chosenMode: null,
      chosenModel: null,
      fallbackReason: null,
      attempts: [],
      selectedSnapshotPaths: [],
      videoSizeBytes: null,
      videoMimeType: null,
    }
    this.lastRunDiagnostics = diagnostics

    if (!this.client) {
      diagnostics.fallbackReason = 'semantic service is not configured'
      return ''
    }

    if (!this.hasActiveProvider()) {
      diagnostics.fallbackReason = 'no active LLM provider'
      return ''
    }

    const videoPrompt = buildSemanticPrompt(
      input.activity,
      'video',
      this.userContextGetter?.() ?? undefined,
    )
    diagnostics.promptChars = videoPrompt.length

    const providerSupportsVideo = this.activeProviderSupportsVideo()
    const shouldAttemptVideo = this.pipelinePreference !== 'image' && providerSupportsVideo
    const shouldAttemptSnapshots = this.pipelinePreference !== 'video'

    if (this.pipelinePreference !== 'image' && !providerSupportsVideo) {
      diagnostics.fallbackReason = 'active provider does not support video'
    }

    if (shouldAttemptVideo) {
      if (typeof input.videoPath === 'string' && input.videoPath.trim().length > 0) {
        const videoAsset = tryLoadVideoAsDataUrl(input.videoPath, this.maxVideoBytes)
        if (videoAsset) {
          diagnostics.videoSizeBytes = videoAsset.sizeBytes
          diagnostics.videoMimeType = videoAsset.mimeType

          const videoResult = await trySemanticModelChain({
            client: this.client,
            requestTimeoutMs: this.requestTimeoutMs,
            mode: 'video',
            models: this.videoModels,
            prompt: videoPrompt,
            diagnostics,
            buildContent: () => [
              { type: 'text', text: videoPrompt },
              { type: 'input_video', videoUrl: { url: videoAsset.dataUrl } },
            ],
            onRecordUsage: ({ model, promptTokens, completionTokens }) => {
              recordSemanticUsageSafe({
                usageTracker: this.usageTracker,
                model,
                promptTokens,
                completionTokens,
              })
            },
            onDumpRoundTrip: (roundTrip) => this.dumpRoundTripSafe(roundTrip),
          })

          if (videoResult) {
            diagnostics.chosenMode = 'video'
            diagnostics.chosenModel = videoResult.model
            this.recordLlmSuccess()
            return videoResult.summary
          }

          diagnostics.fallbackReason = 'all video models failed'
        } else {
          diagnostics.fallbackReason = 'video unavailable or exceeds configured size limit'
        }
      } else {
        diagnostics.fallbackReason = 'video unavailable'
      }
    } else if (this.pipelinePreference === 'image') {
      diagnostics.fallbackReason = 'video pipeline disabled by preference'
    }

    if (!shouldAttemptSnapshots) {
      if (!diagnostics.fallbackReason) {
        diagnostics.fallbackReason = 'snapshot pipeline disabled by preference'
      }
      this.updateLlmHealthFromDiagnostics(diagnostics)
      return ''
    }

    const snapshotCap = this.resolveSnapshotCap()
    const selectedSnapshots = await selectSnapshotFrames({
      frames: input.activity.frames,
      maxSnapshots: snapshotCap,
      startAnchorTimestamp: input.activity.startTimestamp,
      endAnchorTimestamp: input.activity.endTimestamp,
      interactionAnchorTimestamps: input.activity.interactions.map(
        (interaction) => interaction.timestamp,
      ),
      visualThresholdPercent: VISUAL_DETECTOR_CONFIG.DHASH_THRESHOLD_PERCENT,
    })
    diagnostics.selectedSnapshotPaths = selectedSnapshots.map((frame) => frame.frame.filepath)

    if (selectedSnapshots.length === 0) {
      this.updateLlmHealthFromDiagnostics(diagnostics)
      return ''
    }

    const encodedSnapshots = await encodeSnapshots({
      frames: selectedSnapshots,
      onEncodeError: ({ filepath, error }) => {
        log.warn(
          '[ActivitySemanticService] Failed to encode snapshot frame',
          JSON.stringify({ filepath, error: describeSemanticError(error) }),
        )
      },
    })
    if (encodedSnapshots.length === 0) {
      this.updateLlmHealthFromDiagnostics(diagnostics)
      return ''
    }

    const snapshotPrompt = buildSemanticPrompt(
      input.activity,
      'snapshot',
      this.userContextGetter?.() ?? undefined,
    )
    const snapshotResult = await trySemanticModelChain({
      client: this.client,
      requestTimeoutMs: this.requestTimeoutMs,
      mode: 'snapshot',
      models: this.snapshotModels,
      prompt: snapshotPrompt,
      diagnostics,
      buildContent: () => {
        const content: ChatContentItem[] = [{ type: 'text', text: snapshotPrompt }]
        for (const image of encodedSnapshots) {
          content.push({
            type: 'image_url',
            imageUrl: { url: image.dataUrl, detail: 'high' },
          })
        }
        return content
      },
      onRecordUsage: ({ model, promptTokens, completionTokens }) => {
        recordSemanticUsageSafe({
          usageTracker: this.usageTracker,
          model,
          promptTokens,
          completionTokens,
        })
      },
      onDumpRoundTrip: (roundTrip) => this.dumpRoundTripSafe(roundTrip),
    })

    if (snapshotResult) {
      diagnostics.chosenMode = 'snapshot'
      diagnostics.chosenModel = snapshotResult.model
      this.recordLlmSuccess()
      return snapshotResult.summary
    }

    if (!diagnostics.fallbackReason) {
      diagnostics.fallbackReason = 'all snapshot models failed'
    }

    this.updateLlmHealthFromDiagnostics(diagnostics)

    return ''
  }

  getLastRunDiagnostics(): SemanticRunDiagnostics | null {
    if (!this.lastRunDiagnostics) return null
    return {
      ...this.lastRunDiagnostics,
      attempts: this.lastRunDiagnostics.attempts.map((attempt) => ({ ...attempt })),
      selectedSnapshotPaths: [...this.lastRunDiagnostics.selectedSnapshotPaths],
    }
  }

  private hasActiveProvider(): boolean {
    if (this.usesInjectedClient) return true
    return this.resolver !== null && this.resolver.getActive() !== null
  }

  private activeProviderSupportsVideo(): boolean {
    if (this.usesInjectedClient) return true
    const active = this.resolver?.getActive()
    if (!active) return false
    return getCapabilities(active.kind).video
  }

  private assertInput(input: { activity: Activity; videoPath?: string }): void {
    if (!input.activity || typeof input.activity !== 'object') {
      throw new Error('summarizeFromVideo requires a valid activity object')
    }
    if (!input.activity.id || input.activity.id.trim().length === 0) {
      throw new Error('summarizeFromVideo requires activity.id')
    }
  }

  private normalizePipelinePreference(
    preference: SemanticPipelinePreference | null | undefined,
  ): SemanticPipelinePreference {
    if (preference === 'video' || preference === 'image') {
      return preference
    }
    return 'auto'
  }

  private resolveSnapshotCap(): number {
    const fromSettings = ACTIVITY_CONFIG.MAX_SCREENSHOTS_FOR_LLM
    if (Number.isInteger(fromSettings) && fromSettings > 0) {
      return fromSettings
    }
    return 1
  }

  private assertValidRequestTimeoutMs(timeoutMs: number): void {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('requestTimeoutMs must be > 0')
    }
  }

  private dumpRoundTripSafe(input: {
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
  }): void {
    try {
      this.debugDumper?.dumpRoundTrip(input)
    } catch (error) {
      log.warn(
        '[ActivitySemanticService] Debug dump failed',
        JSON.stringify({
          activityId: input.activityId,
          mode: input.mode,
          model: input.model,
          error: describeSemanticError(error),
        }),
      )
    }
  }

  private resetLlmHealth(): void {
    this.llmHealth = {
      consecutiveFailures: 0,
      lastError: null,
      lastAttemptAt: null,
      lastSuccessAt: null,
    }
  }

  private recordLlmSuccess(): void {
    const now = Date.now()
    this.llmHealth.consecutiveFailures = 0
    this.llmHealth.lastError = null
    this.llmHealth.lastAttemptAt = now
    this.llmHealth.lastSuccessAt = now
  }

  private updateLlmHealthFromDiagnostics(diagnostics: SemanticRunDiagnostics): void {
    const failedAttempts = diagnostics.attempts.filter((attempt) => !attempt.success)
    const actionableFailures = failedAttempts.filter((attempt) => attempt.error !== 'empty summary')

    if (actionableFailures.length === 0) {
      return
    }

    const lastFailure = actionableFailures[actionableFailures.length - 1]
    this.llmHealth.consecutiveFailures += 1
    this.llmHealth.lastError = lastFailure?.error ?? 'Unknown LLM error'
    this.llmHealth.lastAttemptAt = Date.now()
  }

  private async runConnectionTest(): Promise<void> {
    const model = this.getProbeModel()
    if (!model || !this.client) {
      this.resetLlmHealth()
      return
    }

    const startedAt = Date.now()
    const request: ChatRequest = {
      model,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Reply with OK.' }],
        },
      ],
    }

    try {
      const response = (await this.withTimeout(
        this.client.chat.send(request),
        this.requestTimeoutMs,
        `semantic model request timed out after ${this.requestTimeoutMs}ms`,
      )) as ChatResponseLike
      const summary = extractSemanticSummary(response)
      if (summary.length === 0) {
        throw new Error('empty summary')
      }
      this.recordLlmSuccess()
      log.info(
        '[ActivitySemanticService] Connection test succeeded',
        JSON.stringify({ model, durationMs: Date.now() - startedAt }),
      )
    } catch (error) {
      const detail = describeSemanticError(error)
      this.llmHealth.consecutiveFailures += 1
      this.llmHealth.lastError = detail
      this.llmHealth.lastAttemptAt = Date.now()
      log.warn(
        '[ActivitySemanticService] Connection test failed',
        JSON.stringify({ model, durationMs: Date.now() - startedAt, error: detail }),
      )
    }
  }

  private getProbeModel(): string | null {
    return this.snapshotModels[0] ?? null
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(message))
      }, timeoutMs)
    })

    try {
      return await Promise.race([promise, timeoutPromise])
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
    }
  }
}
