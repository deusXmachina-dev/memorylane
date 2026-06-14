import * as fs from 'fs'
import * as path from 'path'
import { generateText } from 'ai'
import log from '../logger'
import type { InferenceProvider } from '../llm'
import { extractJsonObject } from '../services/pattern-detector/helpers'
import type { JudgeResult } from './types'

/**
 * One holistic LLM judge call per summary. Multimodal: the judge sees the same
 * frames the summarizer saw, plus the OCR text (an independent ground-truth
 * channel the summarizer never received) and grades the summary 0-10 for recall
 * usefulness, grounding, and the absence of fabrication / raw-interaction
 * narration. Returns null if the call or parse fails (scored as "no judge").
 */

const DEFAULT_MAX_IMAGES = 6

export interface JudgeParams {
  provider: InferenceProvider
  judgeModel: string
  summary: string
  ocrText: string
  metadata: { appName: string; windowTitle?: string; tld?: string; durationMs: number }
  /** Frames the summarizer saw (selected snapshots preferred, else activity frames). */
  imagePaths: string[]
  maxImages?: number
  signal?: AbortSignal
}

function mediaTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

function encodeImage(filePath: string): { type: 'file'; data: string; mediaType: string } | null {
  try {
    const buf = fs.readFileSync(filePath)
    const mediaType = mediaTypeFor(filePath)
    return { type: 'file', data: `data:${mediaType};base64,${buf.toString('base64')}`, mediaType }
  } catch {
    return null
  }
}

function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items
  const out: T[] = []
  const step = items.length / max
  for (let i = 0; i < max; i++) out.push(items[Math.floor(i * step)])
  return out
}

function buildPrompt(params: JudgeParams): string {
  const { summary, ocrText, metadata } = params
  const durationStr = `${Math.round(metadata.durationMs / 1000)}s`
  return [
    'You are a strict evaluator grading an activity summary against the visual evidence.',
    'A good summary answers "what was I working on?" usefully for later recall: specific and',
    'grounded in the frames/OCR, no fabricated details, no narration of raw interactions',
    '(clicks/scrolls/keystrokes), and verb strength that matches the evidence (browsing vs editing).',
    '',
    '## Activity metadata',
    `- App: ${metadata.appName}`,
    metadata.windowTitle ? `- Window: ${metadata.windowTitle}` : '',
    metadata.tld ? `- TLD: ${metadata.tld}` : '',
    `- Duration: ${durationStr}`,
    '',
    '## OCR text from a frame (ground truth — the summary author did NOT see this; use it to detect hallucination and missed specifics)',
    ocrText.trim() ? ocrText.trim().slice(0, 4000) : '(no OCR text)',
    '',
    '## Summary to grade',
    summary,
    '',
    '## Scoring',
    'Give one overall score 0-10 (10 = excellent recall summary, fully grounded).',
    'List any specific claims not supported by the evidence in "flaggedClaims".',
    'Respond with ONLY a JSON object: {"score": <0-10>, "notes": "<short>", "flaggedClaims": ["..."]}',
  ]
    .filter((l) => l !== '')
    .join('\n')
}

export async function judgeSummary(params: JudgeParams): Promise<JudgeResult | null> {
  const promptText = buildPrompt(params)
  const content: Array<
    { type: 'text'; text: string } | { type: 'file'; data: string; mediaType: string }
  > = [{ type: 'text', text: promptText }]

  for (const p of sampleEvenly(params.imagePaths, params.maxImages ?? DEFAULT_MAX_IMAGES)) {
    const img = encodeImage(p)
    if (img) content.push(img)
  }

  let result
  try {
    result = await generateText({
      model: params.provider.languageModel(params.judgeModel),
      messages: [{ role: 'user', content }],
      abortSignal: params.signal,
    })
  } catch (err) {
    log.warn('[judge] call failed:', err instanceof Error ? err.message : String(err))
    return null
  }

  const parsed = extractJsonObject<{
    score?: number
    notes?: string
    flaggedClaims?: string[]
  }>(result.text)
  if (!parsed || typeof parsed.score !== 'number') {
    log.warn('[judge] could not parse judge JSON; raw text:', result.text.slice(0, 200))
    return null
  }

  return {
    score10: Math.max(0, Math.min(10, Math.round(parsed.score * 100) / 100)),
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    flaggedClaims: Array.isArray(parsed.flaggedClaims)
      ? parsed.flaggedClaims.filter((c): c is string => typeof c === 'string')
      : [],
    judgeModel: params.judgeModel,
    tokensIn: result.usage.inputTokens ?? 0,
    tokensOut: result.usage.outputTokens ?? 0,
  }
}

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

  try {
    const result = await generateText({
      model: params.provider.languageModel(params.model),
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      abortSignal: params.signal,
    })
    const parsed = extractJsonObject<{ equivalence?: number }>(result.text)
    if (!parsed || typeof parsed.equivalence !== 'number') return null
    return {
      equivalence: Math.max(0, Math.min(1, parsed.equivalence)),
      tokensIn: result.usage.inputTokens ?? 0,
      tokensOut: result.usage.outputTokens ?? 0,
    }
  } catch (err) {
    log.warn('[judge] equivalence call failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}
