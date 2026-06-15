import { generateText } from 'ai'
import log from '../logger'
import type { InferenceProvider } from '../llm'
import { extractJsonObject } from '../services/pattern-detector/helpers'
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

  try {
    const result = await generateText({
      model: params.provider.languageModel(params.model),
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      abortSignal: params.signal,
    })
    const parsed = extractJsonObject<{ equivalence?: number; notes?: string }>(result.text)
    if (!parsed) {
      log.warn('[task-judge] could not parse JSON; raw:', result.text.slice(0, 200))
      return null
    }
    return {
      equivalence: typeof parsed.equivalence === 'number' ? clamp(0, 1, parsed.equivalence) : null,
      tokensIn: result.usage.inputTokens ?? 0,
      tokensOut: result.usage.outputTokens ?? 0,
    }
  } catch (err) {
    log.warn('[task-judge] call failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}
