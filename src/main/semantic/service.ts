import { ACTIVITY_CONFIG, VISUAL_DETECTOR_CONFIG } from '@constants'
import log from '../logger'
import { UsageTracker } from '../services/usage-tracker'
import type { Activity } from '../activity-types'
import type { ActivitySemanticService as SemanticServiceContract } from '../activity-transformer-types'
import type { InferenceProvider } from '../llm'
import type { CustomEndpointManager } from '../settings/custom-endpoint-manager'
import type { CustomEndpointConfig } from '../../shared/types'
import { DEFAULT_SNAPSHOT_MODELS, DEFAULT_VIDEO_MODELS } from './constants'
import {
  customEndpointVideoUnsupportedCacheKey,
  getEffectiveSemanticModels,
  isLikelyCustomEndpointVideoUnsupportedError,
  normalizeCustomEndpointModel,
} from './custom-endpoint-video-fallback'
import { invokeViaGenerateText, invokeRawVideoCompletion } from './invoke'
import { tryLoadVideoAsDataUrl, encodeSnapshots } from './media'
import { trySemanticModelChain } from './model-chain'
import { buildSemanticPrompt } from './prompt'
import { describeSemanticError } from './response-utils'
import { selectSnapshotFrames } from './sampling'
import { recordSemanticUsageSafe } from './usage-recording'
import type {
  ChatContentItem,
  LlmHealthStatus,
  SemanticPipelinePreference,
  ActivitySemanticServiceConfig,
  SemanticRoundTripDump,
  SemanticRunDiagnostics,
} from './types'

export class ActivitySemanticService implements SemanticServiceContract {
  private readonly provider: InferenceProvider
  private readonly customEndpointManager: CustomEndpointManager | null
  private videoModels: string[]
  private snapshotModels: string[]
  private readonly maxVideoBytes: number
  private requestTimeoutMs: number
  private pipelinePreference: SemanticPipelinePreference
  private readonly usageTracker: ActivitySemanticServiceConfig['usageTracker']
  private readonly debugDumper: ActivitySemanticServiceConfig['debugDumper']
  private readonly fetchImpl: typeof globalThis.fetch | undefined
  private readonly videoUnsupportedCustomModels = new Set<string>()
  private readonly unsubscribeProvider: () => void

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

  constructor(provider: InferenceProvider, config?: ActivitySemanticServiceConfig) {
    this.provider = provider
    this.customEndpointManager = config?.customEndpointManager ?? null
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
    this.fetchImpl = config?.fetchImpl

    if (!Number.isFinite(this.maxVideoBytes) || this.maxVideoBytes <= 0) {
      throw new Error('maxVideoBytes must be > 0')
    }
    this.assertValidRequestTimeoutMs(this.requestTimeoutMs)

    this.unsubscribeProvider = this.provider.onConfigChanged(() => {
      this.videoUnsupportedCustomModels.clear()
      this.resetLlmHealth()
    })
  }

  isConfigured(): boolean {
    return this.provider.isConfigured()
  }

  isUsingCustomEndpoint(): boolean {
    return this.getCustomEndpoint() !== null
  }

  private getCustomEndpoint(): CustomEndpointConfig | null {
    return this.customEndpointManager?.getEndpoint() ?? null
  }

  private getCustomEndpointModel(): string | null {
    return normalizeCustomEndpointModel(this.getCustomEndpoint()?.model)
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

  async testConnection(): Promise<void> {
    if (!this.provider.isConfigured()) {
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

  dispose(): void {
    this.unsubscribeProvider()
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

    if (!this.provider.isConfigured()) {
      diagnostics.fallbackReason = 'semantic service is not configured'
      return ''
    }

    const videoPrompt = buildSemanticPrompt(
      input.activity,
      'video',
      this.userContextGetter?.() ?? undefined,
    )
    diagnostics.promptChars = videoPrompt.length

    const shouldAttemptVideo = this.pipelinePreference !== 'image'
    const shouldAttemptSnapshots = this.pipelinePreference !== 'video'

    if (shouldAttemptVideo) {
      if (this.shouldSkipCustomEndpointVideo()) {
        diagnostics.fallbackReason = 'custom endpoint model marked video-unsupported (session)'
        log.info(
          '[ActivitySemanticService] Skipping video summarization for custom endpoint model',
          JSON.stringify({
            activityId: input.activity.id,
            model: this.getCustomEndpointModel(),
          }),
        )
      } else if (typeof input.videoPath === 'string' && input.videoPath.trim().length > 0) {
        const videoAsset = tryLoadVideoAsDataUrl(input.videoPath, this.maxVideoBytes)
        if (videoAsset) {
          diagnostics.videoSizeBytes = videoAsset.sizeBytes
          diagnostics.videoMimeType = videoAsset.mimeType

          const videoResult = await trySemanticModelChain({
            requestTimeoutMs: this.requestTimeoutMs,
            mode: 'video',
            models: this.getEffectiveVideoModels(),
            prompt: videoPrompt,
            diagnostics,
            buildContent: () => [
              { type: 'text', text: videoPrompt },
              { type: 'input_video', videoUrl: { url: videoAsset.dataUrl } },
            ],
            invoke: async ({ model, content, signal }) => {
              const route = this.provider.getRouteSnapshot()
              if (!route) {
                throw new Error('semantic service is not configured')
              }
              return invokeRawVideoCompletion({
                route,
                model,
                content,
                signal,
                fetchImpl: this.fetchImpl,
              })
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
            onAttemptFailed: ({ mode, model, error }) => {
              if (mode === 'video' && this.isLikelyVideoUnsupportedError(error)) {
                this.markCustomEndpointVideoUnsupported(model, error)
              }
            },
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
    } else {
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
      requestTimeoutMs: this.requestTimeoutMs,
      mode: 'snapshot',
      models: this.getEffectiveSnapshotModels(),
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
      invoke: ({ model, content, signal }) =>
        invokeViaGenerateText({ provider: this.provider, model, content, signal }),
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

  private assertInput(input: { activity: Activity; videoPath?: string }): void {
    if (!input.activity || typeof input.activity !== 'object') {
      throw new Error('summarizeFromVideo requires a valid activity object')
    }
    if (!input.activity.id || input.activity.id.trim().length === 0) {
      throw new Error('summarizeFromVideo requires activity.id')
    }
  }

  private getEffectiveVideoModels(): string[] {
    return getEffectiveSemanticModels({
      isCustomEndpoint: this.isUsingCustomEndpoint(),
      customEndpointModel: this.getCustomEndpointModel(),
      defaultModels: this.videoModels,
    })
  }

  private getEffectiveSnapshotModels(): string[] {
    return getEffectiveSemanticModels({
      isCustomEndpoint: this.isUsingCustomEndpoint(),
      customEndpointModel: this.getCustomEndpointModel(),
      defaultModels: this.snapshotModels,
    })
  }

  private customEndpointCacheKey(): string | null {
    const endpoint = this.getCustomEndpoint()
    return customEndpointVideoUnsupportedCacheKey({
      isCustomEndpoint: endpoint !== null,
      serverURL: endpoint?.serverURL ?? null,
      model: normalizeCustomEndpointModel(endpoint?.model),
    })
  }

  private shouldSkipCustomEndpointVideo(): boolean {
    const key = this.customEndpointCacheKey()
    return key !== null && this.videoUnsupportedCustomModels.has(key)
  }

  private markCustomEndpointVideoUnsupported(model: string, reason: string): void {
    const endpoint = this.getCustomEndpoint()
    if (!endpoint) return
    const customModel = normalizeCustomEndpointModel(endpoint.model)
    if (!customModel || customModel !== model) return

    const key = this.customEndpointCacheKey()
    if (!key || this.videoUnsupportedCustomModels.has(key)) return

    this.videoUnsupportedCustomModels.add(key)
    log.info(
      '[ActivitySemanticService] Marked custom endpoint model as video-unsupported for session',
      JSON.stringify({
        serverURL: endpoint.serverURL,
        model,
        reason,
      }),
    )
  }

  private isLikelyVideoUnsupportedError(message: string): boolean {
    if (!this.isUsingCustomEndpoint()) return false
    return isLikelyCustomEndpointVideoUnsupportedError(message)
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

  private dumpRoundTripSafe(input: SemanticRoundTripDump): void {
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
    if (!model || !this.provider.isConfigured()) {
      this.resetLlmHealth()
      return
    }

    const startedAt = Date.now()
    const content: ChatContentItem[] = [{ type: 'text', text: 'Reply with OK.' }]

    try {
      const summary = await this.runProbe(model, content)
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

  private async runProbe(model: string, content: ChatContentItem[]): Promise<string> {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => {
      controller.abort()
    }, this.requestTimeoutMs)
    try {
      const outcome = await invokeViaGenerateText({
        provider: this.provider,
        model,
        content,
        signal: controller.signal,
      })
      return outcome.summary.trim()
    } finally {
      clearTimeout(timeoutHandle)
    }
  }

  private getProbeModel(): string | null {
    const models = this.getEffectiveSnapshotModels()
    return models[0] ?? null
  }
}
