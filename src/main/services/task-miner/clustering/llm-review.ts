import { generateText } from 'ai'
import type { InferenceProvider } from '@main/llm'
import { extractJsonObject } from '../helpers'
import type { ReviewInput, ReviewOutput } from './types'
import { CLUSTERING_CONFIG } from './types'
import { buildClusterReviewSystemPrompt, serializeReviewInput } from './prompts'
import type { ProgressCallback } from '../types'

export interface ReviewCallResult {
  output: ReviewOutput | null
  tokenUsage: { input: number; output: number }
}

/** One review call over all proposals. Returns null output on parse failure. */
export async function runLlmReview(
  provider: InferenceProvider,
  model: string,
  input: ReviewInput,
  progress?: ProgressCallback,
): Promise<ReviewCallResult> {
  const system = buildClusterReviewSystemPrompt()
  const prompt = serializeReviewInput(input)
  const tokenUsage = { input: 0, output: 0 }

  for (let attempt = 1; attempt <= CLUSTERING_CONFIG.LLM_MAX_ATTEMPTS; attempt++) {
    progress?.(
      `[Clustering] Reviewing ${input.clusters.length} clusters, ` +
        `${input.mergeCandidates.length} merge candidates with ${model}` +
        (attempt > 1 ? ` (attempt ${attempt}/${CLUSTERING_CONFIG.LLM_MAX_ATTEMPTS})` : ''),
    )
    const result = await generateText({
      model: provider.languageModel(model),
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
