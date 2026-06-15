import { generateText } from 'ai'
import log from '../logger'
import type { InferenceProvider } from '../llm'
import { extractJsonObject } from '../services/pattern-detector/helpers'
import type { DetectedPattern, GoldenPattern } from './pattern-types'

/**
 * One text-only LLM judge call per matched (golden, detected) pair. Grades two
 * things at once to save tokens: semantic equivalence (do they describe the same
 * repetitive task?) and the detected pattern's automation-idea quality (is it
 * specific and actionable?). Returns null if the call or parse fails.
 *
 * Mirrors `judge.ts`'s `judgeEquivalence`; only run on goldens that had a match.
 */

export interface PatternJudgeResult {
  equivalence: number | null
  automationQuality: number | null
  automationNotes: string | null
  tokensIn: number
  tokensOut: number
}

const clamp = (lo: number, hi: number, x: number): number => Math.max(lo, Math.min(hi, x))

export async function judgePattern(params: {
  provider: InferenceProvider
  model: string
  golden: GoldenPattern
  detected: DetectedPattern
  signal?: AbortSignal
}): Promise<PatternJudgeResult | null> {
  const { golden, detected } = params
  const prompt = [
    'You are grading an automatically-detected work pattern against a known target',
    'pattern (the "golden"). Both describe repetitive, potentially automatable work',
    'someone did on their computer.',
    '',
    '## Golden (target) pattern',
    `- Name: ${golden.name}`,
    `- Description: ${golden.description}`,
    `- Apps: ${golden.apps.join(', ')}`,
    `- Ideal automation: ${golden.automationIdea}`,
    '',
    '## Detected pattern',
    `- Name: ${detected.name}`,
    `- Description: ${detected.description}`,
    `- Apps: ${detected.apps.join(', ')}`,
    `- Automation idea: ${detected.automationIdea}`,
    '',
    '## Scoring',
    '1. "equivalence" (0.0-1.0): do the two describe the SAME underlying repetitive',
    '   task? 1.0 = same task, 0.0 = unrelated. Minor wording differences are fine.',
    '2. "automationQuality" (0-10): is the DETECTED pattern\'s automation idea',
    '   specific, actionable, and technically plausible? 10 = names a concrete',
    '   API/script/tool and the steps; 0 = vague, generic, or missing.',
    'Respond with ONLY JSON: {"equivalence": <0.0-1.0>, "automationQuality": <0-10>, "notes": "<short>"}',
  ].join('\n')

  try {
    const result = await generateText({
      model: params.provider.languageModel(params.model),
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      abortSignal: params.signal,
    })
    const parsed = extractJsonObject<{
      equivalence?: number
      automationQuality?: number
      notes?: string
    }>(result.text)
    if (!parsed) {
      log.warn('[pattern-judge] could not parse JSON; raw:', result.text.slice(0, 200))
      return null
    }
    return {
      equivalence: typeof parsed.equivalence === 'number' ? clamp(0, 1, parsed.equivalence) : null,
      automationQuality:
        typeof parsed.automationQuality === 'number'
          ? clamp(0, 10, Math.round(parsed.automationQuality * 100) / 100)
          : null,
      automationNotes: typeof parsed.notes === 'string' ? parsed.notes : null,
      tokensIn: result.usage.inputTokens ?? 0,
      tokensOut: result.usage.outputTokens ?? 0,
    }
  } catch (err) {
    log.warn('[pattern-judge] call failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}
