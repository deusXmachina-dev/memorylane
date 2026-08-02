import { generateText } from 'ai'
import type { InferenceProvider } from '@main/llm'
import { extractJsonObject, formatApiError } from '../helpers'
import { PATTERN_DETECTION_CONFIG } from '@/shared/constants'
import { scrubPromptPII } from '@/shared/sanitize'
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

export type ReviewScrubber = (texts: string[], allow?: string[]) => Promise<string[]>

function scrubReviewInputForPrompt(input: ReviewInput): ReviewInput {
  return {
    mergeCandidates: input.mergeCandidates,
    clusters: input.clusters.map((cluster) => ({
      ...cluster,
      label: scrubPromptPII(cluster.label),
      members: cluster.members.map((member) => ({
        ...member,
        title: scrubPromptPII(member.title),
        subject: scrubPromptPII(member.subject),
        description: scrubPromptPII(member.description),
        ...(member.steps && { steps: member.steps.map(scrubPromptPII) }),
      })),
    })),
  }
}

/** Runs here because applyStructure/applyContent transactions cannot await;
 * fields are unvalidated model output, so only strings are touched. */
async function scrubReviewOutput(
  output: ReviewOutput,
  input: ReviewInput,
  scrub: ReviewScrubber,
): Promise<ReviewOutput> {
  if (!Array.isArray(output.clusters)) return output
  const texts: string[] = []
  const collect = (value: unknown): number => {
    if (typeof value !== 'string' || value === '') return -1
    texts.push(value)
    return texts.length - 1
  }
  const slots = output.clusters.map((verdict) => ({
    label: collect(verdict.label),
    description: collect(verdict.description),
    mechanism: collect(verdict.mechanism),
    steps: Array.isArray(verdict.steps) ? verdict.steps.map(collect) : [],
    variables: Array.isArray(verdict.variables) ? verdict.variables.map(collect) : [],
  }))
  if (texts.length === 0) return output

  const allow = [...new Set(input.clusters.flatMap((c) => c.members.flatMap((m) => m.apps)))]
  const scrubbed = await scrub(texts, allow)
  const pick = <T>(index: number, original: T): T | string =>
    index >= 0 ? scrubbed[index] : original

  return {
    ...output,
    clusters: output.clusters.map((verdict, i) => ({
      ...verdict,
      ...(slots[i].label >= 0 && { label: scrubbed[slots[i].label] }),
      ...(slots[i].description >= 0 && { description: scrubbed[slots[i].description] }),
      ...(slots[i].mechanism >= 0 && { mechanism: scrubbed[slots[i].mechanism] }),
      ...(Array.isArray(verdict.steps) && {
        steps: verdict.steps.map((step, j) => pick(slots[i].steps[j], step)),
      }),
      ...(Array.isArray(verdict.variables) && {
        variables: verdict.variables.map((v, j) => pick(slots[i].variables[j], v)),
      }),
    })),
  }
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
  scrub?: ReviewScrubber,
): Promise<ReviewCallResult> {
  const prompt = serializeReviewInput(scrubReviewInputForPrompt(input))
  const tokenUsage = { input: 0, output: 0 }

  for (let attempt = 1; attempt <= CLUSTERING_CONFIG.LLM_MAX_ATTEMPTS; attempt++) {
    progress?.(describe(attempt))
    try {
      const result = await generateText({
        model: provider.languageModel(model, PATTERN_DETECTION_CONFIG.REQUEST_TIMEOUT_MS),
        system,
        prompt,
        maxRetries: 0,
      })
      tokenUsage.input += result.usage.inputTokens ?? 0
      tokenUsage.output += result.usage.outputTokens ?? 0

      const parsed = extractJsonObject<ReviewOutput>(result.text)
      if (parsed) {
        const output = scrub ? await scrubReviewOutput(parsed, input, scrub) : parsed
        return { output, tokenUsage }
      }
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
  scrub?: ReviewScrubber,
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
    scrub,
  )
}

/** One content batch: labels, classifications, and recipes. */
export async function runContentReview(
  provider: InferenceProvider,
  model: string,
  input: ReviewInput,
  progress?: ProgressCallback,
  scrub?: ReviewScrubber,
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
    scrub,
  )
}
