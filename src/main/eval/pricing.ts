/**
 * Eval-local model pricing (USD per million tokens). Separate from the
 * production MODEL_PRICING map because the eval uses judge models the app never
 * calls. Unknown models fall back to 0 — cost is reported as a lower bound, not
 * billed, so an unknown judge simply shows $0 rather than throwing.
 */
interface ModelPrice {
  inputPerM: number
  outputPerM: number
}

const PRICING: Record<string, ModelPrice> = {
  // Google / Gemini
  'google/gemini-2.5-flash': { inputPerM: 0.3, outputPerM: 2.5 },
  'gemini-2.5-flash': { inputPerM: 0.3, outputPerM: 2.5 },
  'google/gemini-2.5-flash-lite': { inputPerM: 0.1, outputPerM: 0.4 },
  'google/gemini-2.5-flash-lite-preview-09-2025': { inputPerM: 0.1, outputPerM: 0.4 },
  'google/gemini-2.5-pro': { inputPerM: 1.25, outputPerM: 10 },
  'gemini-2.5-pro': { inputPerM: 1.25, outputPerM: 10 },
  // Moonshot
  'moonshotai/kimi-k2.5': { inputPerM: 0.6, outputPerM: 2.5 },
  // Mistral
  'mistralai/mistral-small-3.2-24b-instruct': { inputPerM: 0.1, outputPerM: 0.3 },
  // Anthropic (common judge models, via openrouter)
  'anthropic/claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15 },
  'anthropic/claude-opus-4-8': { inputPerM: 5, outputPerM: 25 },
}

export function estimateCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const price = PRICING[model]
  if (!price) return 0
  return (tokensIn / 1_000_000) * price.inputPerM + (tokensOut / 1_000_000) * price.outputPerM
}

export function hasPricing(model: string): boolean {
  return model in PRICING
}
