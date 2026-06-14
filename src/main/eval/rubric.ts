import * as fs from 'fs'
import * as path from 'path'
import { generateText } from 'ai'
import log from '../logger'
import type { InferenceProvider } from '../llm'
import { extractJsonObject } from '../services/pattern-detector/helpers'
import type { RubricDimension, RubricScore } from './types'

/**
 * LLM-judge rubric. Multimodal by default: the judge sees the same frames the
 * summarizer saw, plus the OCR text (an independent ground-truth channel the
 * summarizer never received) and the variant's rules. Each dimension is 0-5 and
 * tied to a specific prompt rule. A hard cap pins the aggregate at <= 4.0 when
 * hallucination or noRawInteractions is critically low, so a fluent summary that
 * invents facts or narrates clicks can never score "good".
 */
export interface RubricDimensionSpec {
  key: string
  weight: number
  description: string
}

export const RUBRIC_DIMENSIONS: RubricDimensionSpec[] = [
  {
    key: 'mediaGrounding',
    weight: 0.2,
    description:
      'Claims are supported by the frames/OCR; specifics (files, errors, URLs, UI) are real.',
  },
  {
    key: 'recallUsefulness',
    weight: 0.18,
    description: 'Answers "what was I working on?" usefully for later recall, not a play-by-play.',
  },
  {
    key: 'hallucination',
    weight: 0.15,
    description:
      '5 = nothing invented; 0 = fabricates content not in the evidence. (Higher = less hallucination.)',
  },
  {
    key: 'verbIntensity',
    weight: 0.12,
    description:
      'Verb strength matches evidence (browsed/reviewed vs implemented/debugged); no exaggeration.',
  },
  {
    key: 'prepVsCompletion',
    weight: 0.12,
    description:
      'Preparation vs completion is distinguished; no unconfirmed "sent/submitted/created".',
  },
  {
    key: 'noRawInteractions',
    weight: 0.1,
    description: '5 = no raw clicks/scrolls/keystrokes; translated into meaningful actions.',
  },
  {
    key: 'hedgingCalibration',
    weight: 0.08,
    description: 'Hedges briefly when evidence is partial; confident when it is clear.',
  },
  {
    key: 'formatCompliance',
    weight: 0.05,
    description: '40-100 words, 1-4 sentences, single paragraph, action-first opener.',
  },
]

const HARD_CAP_VALUE = 4.0
const DEFAULT_MAX_IMAGES = 6

export interface JudgeParams {
  provider: InferenceProvider
  judgeModel: string
  summary: string
  ocrText: string
  rules: string
  metadata: { appName: string; windowTitle?: string; tld?: string; durationMs: number }
  /** Frames the summarizer saw (selected snapshots preferred, else activity frames). */
  imagePaths: string[]
  textOnly: boolean
  samples: number
  maxImages?: number
  signal?: AbortSignal
}

interface SampleResult {
  scores: Map<string, number>
  flaggedClaims: string[]
  tokensIn: number
  tokensOut: number
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

function buildJudgePrompt(params: JudgeParams): string {
  const { summary, ocrText, rules, metadata } = params
  const dims = RUBRIC_DIMENSIONS.map((d) => `- ${d.key}: ${d.description}`).join('\n')
  const durationStr = `${Math.round(metadata.durationMs / 1000)}s`
  return [
    'You are a strict evaluator grading an activity summary against the rules it was written under and the visual evidence.',
    '',
    '## Rules the summary must follow',
    rules,
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
    'Score each dimension 0-5 (5 = best). For hallucination and noRawInteractions, higher means fewer violations.',
    dims,
    '',
    'Also list any specific claims in the summary that are not supported by the evidence in "flaggedClaims".',
    'Respond with ONLY a JSON object of this shape:',
    '{"scores": {"<dimension>": {"score": <0-5>, "rationale": "<short>"}, ...}, "flaggedClaims": ["..."]}',
  ]
    .filter((l) => l !== '')
    .join('\n')
}

async function runSample(params: JudgeParams, promptText: string): Promise<SampleResult | null> {
  const content: Array<
    { type: 'text'; text: string } | { type: 'file'; data: string; mediaType: string }
  > = [{ type: 'text', text: promptText }]

  if (!params.textOnly) {
    const chosen = sampleEvenly(params.imagePaths, params.maxImages ?? DEFAULT_MAX_IMAGES)
    for (const p of chosen) {
      const img = encodeImage(p)
      if (img) content.push(img)
    }
  }

  let result
  try {
    result = await generateText({
      model: params.provider.languageModel(params.judgeModel),
      messages: [{ role: 'user', content }],
      abortSignal: params.signal,
    })
  } catch (err) {
    log.warn('[rubric] Judge call failed:', err instanceof Error ? err.message : String(err))
    return null
  }

  const parsed = extractJsonObject<{
    scores?: Record<string, { score?: number; rationale?: string }>
    flaggedClaims?: string[]
  }>(result.text)
  if (!parsed || !parsed.scores) {
    log.warn('[rubric] Could not parse judge JSON; raw text:', result.text.slice(0, 200))
    return null
  }

  const scores = new Map<string, number>()
  for (const d of RUBRIC_DIMENSIONS) {
    const raw = parsed.scores[d.key]?.score
    const n = typeof raw === 'number' ? raw : 0
    scores.set(d.key, Math.max(0, Math.min(5, n)))
  }

  return {
    scores,
    flaggedClaims: Array.isArray(parsed.flaggedClaims)
      ? parsed.flaggedClaims.filter((c): c is string => typeof c === 'string')
      : [],
    tokensIn: result.usage.inputTokens ?? 0,
    tokensOut: result.usage.outputTokens ?? 0,
  }
}

export function computeAggregate(scores: Map<string, number>): {
  aggregate10: number
  capped: boolean
} {
  let weighted = 0
  for (const d of RUBRIC_DIMENSIONS) weighted += (scores.get(d.key) ?? 0) * d.weight
  let agg = (weighted / 5) * 10

  const hallucination = scores.get('hallucination') ?? 0
  const noRaw = scores.get('noRawInteractions') ?? 0
  let capped = false
  if ((hallucination <= 2 || noRaw <= 2) && agg > HARD_CAP_VALUE) {
    agg = HARD_CAP_VALUE
    capped = true
  }
  return { aggregate10: Math.round(agg * 100) / 100, capped }
}

export async function judgeSummary(params: JudgeParams): Promise<RubricScore | null> {
  const promptText = buildJudgePrompt(params)
  const n = Math.max(1, params.samples)

  const samples: SampleResult[] = []
  for (let i = 0; i < n; i++) {
    const s = await runSample(params, promptText)
    if (s) samples.push(s)
  }
  if (samples.length === 0) return null

  // Average each dimension across successful samples.
  const avg = new Map<string, number>()
  for (const d of RUBRIC_DIMENSIONS) {
    const mean = samples.reduce((acc, s) => acc + (s.scores.get(d.key) ?? 0), 0) / samples.length
    avg.set(d.key, Math.round(mean * 100) / 100)
  }

  const { aggregate10, capped } = computeAggregate(avg)
  const dimensions: RubricDimension[] = RUBRIC_DIMENSIONS.map((d) => ({
    key: d.key,
    score: avg.get(d.key) ?? 0,
    rationale: '',
  }))
  const flaggedClaims = [...new Set(samples.flatMap((s) => s.flaggedClaims))]

  return {
    dimensions,
    aggregate10,
    capped,
    flaggedClaims,
    judgeModel: params.judgeModel,
    samples: samples.length,
    tokensIn: samples.reduce((a, s) => a + s.tokensIn, 0),
    tokensOut: samples.reduce((a, s) => a + s.tokensOut, 0),
  }
}
