import { generateText } from 'ai'
import type { InferenceProvider } from '@main/llm'
import { extractJsonObject, formatApiError } from '../helpers'
import { PATTERN_DETECTION_CONFIG } from '@/shared/constants'
import type { ReviewInput, ReviewOutput } from './types'
import { CLUSTERING_CONFIG } from './types'
import {
  buildStructureReviewSystemPrompt,
  buildContentReviewSystemPrompt,
  serializeReviewInput,
} from './prompts'
import type { ProgressCallback } from '../types'

export interface ReviewCallResult {
  output: ReviewOutput | null
  tokenUsage: { input: number; output: number }
}

/**
 * Attempts cover thrown errors too — a transient timeout on a long call must
 * not forfeit the whole pass. The last attempt rethrows so the caller's error
 * accounting sees the real failure.
 */
async function callReview(
  provider: InferenceProvider,
  model: string,
  system: string,
  input: ReviewInput,
  describe: (attempt: number) => string,
  progress?: ProgressCallback,
): Promise<ReviewCallResult> {
  const prompt = serializeReviewInput(input)
  const tokenUsage = { input: 0, output: 0 }

  for (let attempt = 1; attempt <= CLUSTERING_CONFIG.LLM_MAX_ATTEMPTS; attempt++) {
    progress?.(describe(attempt))
    try {
      const result = await generateText({
        model: provider.languageModel(model),
        timeout: PATTERN_DETECTION_CONFIG.REQUEST_TIMEOUT_MS,
        system,
        prompt,
        maxRetries: 0,
      })
      tokenUsage.input += result.usage.inputTokens ?? 0
      tokenUsage.output += result.usage.outputTokens ?? 0

      const parsed = extractJsonObject<ReviewOutput>(result.text)
      if (parsed) return { output: parsed, tokenUsage }
      progress?.(
        `[Clustering] Could not parse review response` +
          (attempt < CLUSTERING_CONFIG.LLM_MAX_ATTEMPTS ? ' — retrying' : ''),
      )
    } catch (error) {
      if (attempt >= CLUSTERING_CONFIG.LLM_MAX_ATTEMPTS) throw error
      progress?.(`[Clustering] Review call failed (${formatApiError(error)}) — retrying`)
    }
  }

  return { output: null, tokenUsage }
}

/** The structure call: merge and split adjudication over all proposals. */
export async function runStructureReview(
  provider: InferenceProvider,
  model: string,
  input: ReviewInput,
  progress?: ProgressCallback,
): Promise<ReviewCallResult> {
  return callReview(
    provider,
    model,
    buildStructureReviewSystemPrompt(),
    input,
    (attempt) =>
      `[Clustering] Structure review: ${input.clusters.length} clusters, ` +
      `${input.mergeCandidates.length} merge candidates with ${model}` +
      (attempt > 1 ? ` (attempt ${attempt}/${CLUSTERING_CONFIG.LLM_MAX_ATTEMPTS})` : ''),
    progress,
  )
}

/** One content batch: labels, classifications, and recipes. */
export async function runContentReview(
  provider: InferenceProvider,
  model: string,
  input: ReviewInput,
  progress?: ProgressCallback,
): Promise<ReviewCallResult> {
  return callReview(
    provider,
    model,
    buildContentReviewSystemPrompt(),
    input,
    (attempt) =>
      `[Clustering] Content review: ${input.clusters.length} clusters with ${model}` +
      (attempt > 1 ? ` (attempt ${attempt}/${CLUSTERING_CONFIG.LLM_MAX_ATTEMPTS})` : ''),
    progress,
  )
}
