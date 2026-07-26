import type { InferenceProvider } from '../llm'
import { callJsonJudge } from './llm-judge'

export interface EquivalenceResult {
  equivalence: number
  tokensIn: number
  tokensOut: number
}

/**
 * Text-only judge: do the candidate and golden summaries describe the same work?
 * Returns 0..1 (1 = same substance). Used to score a replay against the golden.md.
 */
export async function judgeEquivalence(params: {
  provider: InferenceProvider
  model: string
  golden: string
  candidate: string
  signal?: AbortSignal
}): Promise<EquivalenceResult | null> {
  const prompt = [
    'Two summaries describe the same screen-activity session. Rate how equivalent they are in meaning',
    '(do they capture the same work?), 0.0 = unrelated, 1.0 = same substance. Minor wording differences are fine.',
    '',
    `A (golden/target): ${params.golden}`,
    `B (candidate): ${params.candidate}`,
    '',
    'Respond with ONLY JSON: {"equivalence": <0.0-1.0>}',
  ].join('\n')

  const res = await callJsonJudge<{ equivalence?: number }>({
    provider: params.provider,
    model: params.model,
    content: [{ type: 'text', text: prompt }],
    tag: 'judge:equivalence',
    signal: params.signal,
  })
  if (!res || typeof res.parsed.equivalence !== 'number') return null
  return {
    equivalence: Math.max(0, Math.min(1, res.parsed.equivalence)),
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
  }
}
