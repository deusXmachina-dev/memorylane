import { generateText } from 'ai'
import type { InferenceProvider } from '@main/llm'
import { extractJsonObject } from '../helpers'
import { TASK_MINING_REQUEST_TIMEOUT_MS } from '@/shared/constants'
import type { ReviewInput, ReviewOutput } from './types'
import { CLUSTERING_CONFIG } from './types'
import {
  buildClusterReviewSystemPrompt,
  buildRecipeRoundSystemPrompt,
  serializeReviewInput,
} from './prompts'
import type { ProgressCallback } from '../types'

export interface ReviewCallResult {
  output: ReviewOutput | null
  tokenUsage: { input: number; output: number }
}

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
    const result = await generateText({
      model: provider.languageModel(model, TASK_MINING_REQUEST_TIMEOUT_MS),
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
  }

  return { output: null, tokenUsage }
}

/** One review call over all proposals. Returns null output on parse failure. */
export async function runLlmReview(
  provider: InferenceProvider,
  model: string,
  input: ReviewInput,
  progress?: ProgressCallback,
): Promise<ReviewCallResult> {
  return callReview(
    provider,
    model,
    buildClusterReviewSystemPrompt(),
    input,
    (attempt) =>
      `[Clustering] Reviewing ${input.clusters.length} clusters, ` +
      `${input.mergeCandidates.length} merge candidates with ${model}` +
      (attempt > 1 ? ` (attempt ${attempt}/${CLUSTERING_CONFIG.LLM_MAX_ATTEMPTS})` : ''),
    progress,
  )
}

/** The focused recipe round over labeled clusters left without steps. */
export async function runRecipeRound(
  provider: InferenceProvider,
  model: string,
  input: ReviewInput,
  progress?: ProgressCallback,
): Promise<ReviewCallResult> {
  return callReview(
    provider,
    model,
    buildRecipeRoundSystemPrompt(),
    input,
    (attempt) =>
      `[Clustering] Recipe round for ${input.clusters.length} stepless clusters with ${model}` +
      (attempt > 1 ? ` (attempt ${attempt}/${CLUSTERING_CONFIG.LLM_MAX_ATTEMPTS})` : ''),
    progress,
  )
}
