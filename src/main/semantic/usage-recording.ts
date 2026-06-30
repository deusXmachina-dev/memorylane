import log from '@main/utils/logger'
import { MODEL_PRICING_USD_PER_MILLION } from './constants'
import { describeSemanticError } from './response-utils'
import type { UsageTrackerLike } from './types'

export function recordSemanticUsageSafe(input: {
  usageTracker: UsageTrackerLike | undefined
  model: string
  promptTokens: number
  completionTokens: number
}): void {
  const pricing = MODEL_PRICING_USD_PER_MILLION[input.model]
  const cost =
    pricing === undefined
      ? 0
      : (input.promptTokens / 1_000_000) * pricing.input_tokens_per_million +
        (input.completionTokens / 1_000_000) * pricing.completion_tokens_per_million

  try {
    input.usageTracker?.recordUsage({
      prompt_tokens: input.promptTokens,
      completion_tokens: input.completionTokens,
      cost,
    })
  } catch (error) {
    log.warn(
      '[ActivitySemanticService] Usage tracking failed',
      JSON.stringify({
        model: input.model,
        error: describeSemanticError(error),
      }),
    )
  }
}
