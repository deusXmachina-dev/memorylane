import { MODEL_PRICING_USD_PER_MILLION } from '../semantic/constants'

/**
 * USD cost for a single model call, from the shared pricing table. Returns null
 * when the model isn't priced (so the report can show "—" rather than a wrong
 * $0.0000) — distinct from a genuine zero-token call.
 */
export function priceUsd(model: string, tokensIn: number, tokensOut: number): number | null {
  const pricing = MODEL_PRICING_USD_PER_MILLION[model]
  if (!pricing) return null
  return (
    (tokensIn / 1_000_000) * pricing.input_tokens_per_million +
    (tokensOut / 1_000_000) * pricing.completion_tokens_per_million
  )
}

/** Sums a list of per-call costs, treating null (unpriced) as a skipped term.
 *  Returns null only when every term was unpriced (nothing to total). */
export function sumCosts(costs: (number | null)[]): number | null {
  const known = costs.filter((c): c is number => c != null)
  return known.length ? known.reduce((a, b) => a + b, 0) : null
}
