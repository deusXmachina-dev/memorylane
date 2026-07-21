import { generateText } from 'ai'
import log from '@main/utils/logger'
import type { InferenceProvider } from '../llm'
import { extractJsonObject } from '../services/task-miner/helpers'

/** A user-message content part the judge prompt can carry (text, or an image). */
export type JudgeContent =
  | { type: 'text'; text: string }
  | { type: 'file'; data: string; mediaType: string }

export interface JudgeCallResult<T> {
  parsed: T
  tokensIn: number
  tokensOut: number
}

/**
 * Shared scaffold for an LLM judge call that returns parsed JSON: runs
 * `generateText`, extracts a JSON object from the reply, and reports token usage.
 * Returns null (logged under `tag`) when the call throws or the reply doesn't
 * parse — every judge in the eval treats that as "no score". Callers build the
 * prompt (text-only or multimodal) and validate the parsed shape.
 */
export async function callJsonJudge<T extends object>(params: {
  provider: InferenceProvider
  model: string
  content: JudgeContent[]
  tag: string
  signal?: AbortSignal
}): Promise<JudgeCallResult<T> | null> {
  let result
  try {
    result = await generateText({
      model: params.provider.languageModel(params.model),
      messages: [{ role: 'user', content: params.content }],
      abortSignal: params.signal,
    })
  } catch (err) {
    log.warn(`[${params.tag}] call failed:`, err instanceof Error ? err.message : String(err))
    return null
  }

  const parsed = extractJsonObject<T>(result.text)
  if (!parsed) {
    log.warn(`[${params.tag}] could not parse judge JSON; raw:`, result.text.slice(0, 200))
    return null
  }
  return {
    parsed,
    tokensIn: result.usage.inputTokens ?? 0,
    tokensOut: result.usage.outputTokens ?? 0,
  }
}
