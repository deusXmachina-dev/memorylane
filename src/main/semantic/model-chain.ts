import log from '@main/utils/logger'
import { extractHttpStatus } from './error-classify'
import { describeSemanticError, safeJsonStringify } from './response-utils'
import type {
  AttemptResult,
  ChatContentItem,
  SemanticMode,
  SemanticRoundTripDump,
  SemanticRunDiagnostics,
} from './types'

/**
 * Outcome of a single LLM call. Returned by the `invoke` callback in
 * trySemanticModelChain.
 */
export interface ChainAttemptOutcome {
  summary: string
  promptTokens: number
  completionTokens: number
  /** Optional response payload to write into debug dumps. */
  responseDump?: unknown
}

export interface TrySemanticModelChainParams {
  requestTimeoutMs: number
  mode: SemanticMode
  models: string[]
  prompt: string
  diagnostics: SemanticRunDiagnostics
  buildContent: (model: string) => ChatContentItem[]
  /**
   * Invoke the LLM for `model` with `content`. Implementations choose the
   * underlying transport (AI SDK generateText, raw HTTP, etc.).
   */
  invoke: (input: {
    model: string
    content: ChatContentItem[]
    signal: AbortSignal
  }) => Promise<ChainAttemptOutcome>
  onRecordUsage(input: { model: string; promptTokens: number; completionTokens: number }): void
  onDumpRoundTrip(input: SemanticRoundTripDump): void
  onAttemptFailed?(input: { mode: SemanticMode; model: string; error: string }): void
}

export async function trySemanticModelChain(
  params: TrySemanticModelChainParams,
): Promise<AttemptResult | null> {
  if (params.models.length === 0) {
    return null
  }

  for (const model of params.models) {
    const content = params.buildContent(model)
    const requestForDump = { model, messages: [{ role: 'user' as const, content }] }
    const requestJson = safeJsonStringify(requestForDump)
    const startedAt = Date.now()

    try {
      const outcome = await withTimeout(
        (signal) => params.invoke({ model, content, signal }),
        params.requestTimeoutMs,
        `semantic model request timed out after ${params.requestTimeoutMs}ms`,
      )

      const durationMs = Date.now() - startedAt
      const summary = outcome.summary.trim()
      const responseJson = outcome.responseDump
        ? safeJsonStringify(outcome.responseDump)
        : undefined

      if (summary.length === 0) {
        params.diagnostics.attempts.push({
          mode: params.mode,
          model,
          durationMs,
          success: false,
          error: 'empty summary',
          promptTokens: outcome.promptTokens,
          completionTokens: outcome.completionTokens,
        })

        params.onDumpRoundTrip({
          activityId: params.diagnostics.activityId,
          mode: params.mode,
          model,
          startedAt,
          durationMs,
          success: false,
          request: requestForDump,
          error: 'empty summary',
          requestJson,
          responseJson,
          summary,
        })
        continue
      }

      params.diagnostics.attempts.push({
        mode: params.mode,
        model,
        durationMs,
        success: true,
        promptTokens: outcome.promptTokens,
        completionTokens: outcome.completionTokens,
      })

      params.onRecordUsage({
        model,
        promptTokens: outcome.promptTokens,
        completionTokens: outcome.completionTokens,
      })

      params.onDumpRoundTrip({
        activityId: params.diagnostics.activityId,
        mode: params.mode,
        model,
        startedAt,
        durationMs,
        success: true,
        request: requestForDump,
        requestJson,
        responseJson,
        summary,
      })

      log.info(
        '[ActivitySemanticService] Semantic summary succeeded',
        JSON.stringify({
          activityId: params.diagnostics.activityId,
          mode: params.mode,
          model,
          durationMs,
          promptChars: params.prompt.length,
          attemptsSoFar: params.diagnostics.attempts.length,
        }),
      )

      return { summary, model }
    } catch (error) {
      const durationMs = Date.now() - startedAt
      const detail = describeSemanticError(error)

      params.diagnostics.attempts.push({
        mode: params.mode,
        model,
        durationMs,
        success: false,
        error: detail,
        httpStatus: extractHttpStatus(error),
      })

      params.onDumpRoundTrip({
        activityId: params.diagnostics.activityId,
        mode: params.mode,
        model,
        startedAt,
        durationMs,
        success: false,
        request: requestForDump,
        requestJson,
        error: detail,
      })

      log.warn(
        '[ActivitySemanticService] Semantic attempt failed',
        JSON.stringify({
          activityId: params.diagnostics.activityId,
          mode: params.mode,
          model,
          durationMs,
          error: detail,
        }),
      )

      params.onAttemptFailed?.({
        mode: params.mode,
        model,
        error: detail,
      })
    }
  }

  return null
}

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const controller = new AbortController()
  let timeoutHandle: NodeJS.Timeout | null = null

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort()
      reject(new Error(message))
    }, timeoutMs)
  })

  try {
    return await Promise.race([fn(controller.signal), timeoutPromise])
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}
