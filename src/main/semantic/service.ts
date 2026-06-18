import { ACTIVITY_CONFIG, VISUAL_DETECTOR_CONFIG } from '@constants'
import log from '../logger'
import { UsageTracker } from '../services/usage-tracker'
import type { Activity } from '../activity-types'
import type { ActivitySemanticService as SemanticServiceContract } from '../activity-transformer-types'
import type { InferenceProvider } from '../llm'
import {
  isLikelyVideoUnsupportedError,
  videoUnsupportedCacheKey,
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
  private videoModels: string[]
  private snapshotModels: string[]
  private readonly maxVideoBytes: number
  private requestTimeoutMs: number
  private pipelinePreference: SemanticPipelinePreference
  private readonly usageTracker: ActivitySemanticServiceConfig['usageTracker']
  private readonly debugDumper: ActivitySemanticServiceConfig['debugDumper']
  private readonly fetchImpl: typeof globalThis.fetch | undefined
  private readonly videoUnsupportedKeys = new Set<string>()
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
    this.videoModels = config?.videoModels ? [...config.videoModels] : []
    this.snapshotModels = config?.snapshotModels ? [...config.snapshotModels] : []
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
      this.videoUnsupportedKeys.clear()
      this.resetLlmHealth()
    })
  }

  isConfigured(): boolean {
    return this.provider.isConfigured()
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
    this.videoModels = [...videoModels]
    this.snapshotModels = [...snapshotModels]
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

  async summarizeFromVideo(input: {
    activity: Activity
    videoPath?: string
  }): Promise<{ summary: string; model: string }> {
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
      return { summary: '', model: '' }
    }

    const videoPrompt = buildSemanticPrompt(
      input.activity,
      'video',
      this.userContextGetter?.() ?? undefined,
    )
    diagnostics.promptChars = videoPrompt.length

    const shouldAttemptVideo = this.pipelinePreference !== 'image' && this.videoModels.length > 0
    const shouldAttemptSnapshots = this.pipelinePreference !== 'video'

    if (shouldAttemptVideo) {
      const effectiveVideoModels = this.filterCachedSupportedVideoModels()
      if (effectiveVideoModels.length === 0) {
        diagnostics.fallbackReason = 'all video models marked unsupported (session)'
        log.info(
          '[ActivitySemanticService] Skipping video summarization; all configured video models are cached as unsupported on this route',
          JSON.stringify({
            activityId: input.activity.id,
            vendor: this.provider.getActiveVendor(),
            models: this.videoModels,
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
            models: effectiveVideoModels,
            prompt: videoPrompt,
            diagnostics,
            buildContent: () => [
              { type: 'text', text: videoPrompt },
              { type: 'input_video', videoUrl: { url: videoAsset.dataUrl } },
            ],
            invoke: async ({ model, content, signal }) => {
              const route = this.provider.getRouteSnapshot()
              if (route) {
                return invokeRawVideoCompletion({
                  route,
                  model,
                  content,
                  signal,
                  fetchImpl: this.fetchImpl,
                })
              }
              // Native vendors (openai, anthropic, google) handle file parts
              // through the AI SDK directly.
              return invokeViaGenerateText({ provider: this.provider, model, content, signal })
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
              if (mode === 'video' && this.shouldMarkUnsupported(error)) {
                this.markVideoUnsupported(model, error)
              }
            },
          })

          if (videoResult) {
            diagnostics.chosenMode = 'video'
            diagnostics.chosenModel = videoResult.model
            this.recordLlmSuccess()
            return { summary: videoResult.summary, model: videoResult.model }
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
    } else if (this.videoModels.length === 0) {
      diagnostics.fallbackReason = 'no video model configured for active vendor'
    }

    if (!shouldAttemptSnapshots || this.snapshotModels.length === 0) {
      if (!diagnostics.fallbackReason) {
        diagnostics.fallbackReason =
          this.snapshotModels.length === 0
            ? 'no snapshot model configured for active vendor'
            : 'snapshot pipeline disabled by preference'
      }
      this.updateLlmHealthFromDiagnostics(diagnostics)
      return { summary: '', model: '' }
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
      return { summary: '', model: '' }
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
      return { summary: '', model: '' }
    }

    const snapshotPrompt = buildSemanticPrompt(
      input.activity,
      'snapshot',
      this.userContextGetter?.() ?? undefined,
    )
    const snapshotResult = await trySemanticModelChain({
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
      return { summary: snapshotResult.summary, model: snapshotResult.model }
    }

    if (!diagnostics.fallbackReason) {
      diagnostics.fallbackReason = 'all snapshot models failed'
    }

    this.updateLlmHealthFromDiagnostics(diagnostics)

    return { summary: '', model: '' }
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

  private currentRouteCacheKey(model: string): string | null {
    const route = this.provider.getRouteSnapshot()
    if (!route) return null
    return videoUnsupportedCacheKey({
      vendor: route.vendor,
      baseURL: route.baseURL,
      model,
    })
  }

  private filterCachedSupportedVideoModels(): string[] {
    return this.videoModels.filter((model) => {
      const key = this.currentRouteCacheKey(model)
      return key === null || !this.videoUnsupportedKeys.has(key)
    })
  }

  private markVideoUnsupported(model: string, reason: string): void {
    const key = this.currentRouteCacheKey(model)
    if (!key || this.videoUnsupportedKeys.has(key)) return
    this.videoUnsupportedKeys.add(key)
    log.info(
      '[ActivitySemanticService] Marked model as video-unsupported for session',
      JSON.stringify({
        vendor: this.provider.getActiveVendor(),
        model,
        reason,
      }),
    )
  }

  private shouldMarkUnsupported(message: string): boolean {
    if (this.provider.getActiveVendor() !== 'openai-compatible') return false
    return isLikelyVideoUnsupportedError(message)
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
    const recoveredFrom = this.llmHealth.consecutiveFailures
    this.llmHealth.consecutiveFailures = 0
    this.llmHealth.lastError = null
    this.llmHealth.lastAttemptAt = now
    this.llmHealth.lastSuccessAt = now
    if (recoveredFrom > 0) {
      log.info(
        `[ActivitySemanticService] LLM recovered after ${recoveredFrom} consecutive failure(s)`,
      )
    }
  }

  private updateLlmHealthFromDiagnostics(diagnostics: SemanticRunDiagnostics): void {
    const failedAttempts = diagnostics.attempts.filter((attempt) => !attempt.success)
    const actionableFailures = failedAttempts.filter((attempt) => attempt.error !== 'empty summary')

    if (actionableFailures.length === 0) {
      return
    }

    const wasHealthy = this.llmHealth.consecutiveFailures === 0
    const lastFailure = actionableFailures[actionableFailures.length - 1]
    this.llmHealth.consecutiveFailures += 1
    this.llmHealth.lastError = lastFailure?.error ?? 'Unknown LLM error'
    this.llmHealth.lastAttemptAt = Date.now()
    // Log only the passing→failing transition; per-request failures would be noise.
    if (wasHealthy) {
      log.warn(`[ActivitySemanticService] LLM started failing: ${this.llmHealth.lastError}`)
    }
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
    return this.snapshotModels[0] ?? null
  }
}
