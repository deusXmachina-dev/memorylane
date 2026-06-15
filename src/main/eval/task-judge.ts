import type { InferenceProvider } from '../llm'
import { callJsonJudge } from './llm-judge'
import type { DetectedSighting, GoldenSighting } from './task-types'

/**
 * One text-only LLM judge call per matched (golden, detected) sighting pair.
 * Grades a single thing: semantic equivalence — do the two describe the SAME
 * underlying task instance? Grounding (which activities) is scored
 * deterministically; this only catches the case where the ids overlap but the
 * miner's title/description mean something different. Returns null on failure.
 *
 * Mirrors `judge.ts`'s `judgeEquivalence`; only run on goldens that had a match.
 */

export interface TaskJudgeResult {
  equivalence: number | null
  tokensIn: number
  tokensOut: number
}

const clamp = (lo: number, hi: number, x: number): number => Math.max(lo, Math.min(hi, x))

export async function judgeSighting(params: {
  provider: InferenceProvider
  model: string
  golden: GoldenSighting
  detected: DetectedSighting
  signal?: AbortSignal
}): Promise<TaskJudgeResult | null> {
  const { golden, detected } = params
  const prompt = [
    'You are grading an automatically-mined task instance against a known target',
    'task (the "golden"). Both describe a discrete piece of work someone did on',
    'their computer.',
    '',
    '## Golden (target) task',
    `- Title: ${golden.title}`,
    `- Description: ${golden.description}`,
    `- Apps: ${golden.apps.join(', ')}`,
    '',
    '## Mined task',
    `- Title: ${detected.title}`,
    `- Description: ${detected.description}`,
    `- Apps: ${detected.apps.join(', ')}`,
    '',
    '## Scoring',
    '"equivalence" (0.0-1.0): do the two describe the SAME underlying task?',
    '1.0 = same task, 0.0 = unrelated. Minor wording differences are fine.',
    'Respond with ONLY JSON: {"equivalence": <0.0-1.0>, "notes": "<short>"}',
  ].join('\n')

  const res = await callJsonJudge<{ equivalence?: number; notes?: string }>({
    provider: params.provider,
    model: params.model,
    content: [{ type: 'text', text: prompt }],
    tag: 'task-judge',
    signal: params.signal,
  })
  if (!res) return null
  return {
    equivalence:
      typeof res.parsed.equivalence === 'number' ? clamp(0, 1, res.parsed.equivalence) : null,
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
  }
}
