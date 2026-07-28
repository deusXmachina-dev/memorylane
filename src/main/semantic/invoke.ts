import { generateText } from 'ai'
import type { InferenceProvider, VendorRouteSnapshot } from '../llm'
import type { ChainAttemptOutcome } from './model-chain'
import type { ChatContentItem } from './types'

interface SnapshotInvokeInput {
  provider: InferenceProvider
  model: string
  content: ChatContentItem[]
  signal: AbortSignal
  requestTimeoutMs: number
}

/**
 * Snapshot/text path: uses Vercel AI SDK's generateText. Image content items
 * are converted into AI SDK FilePart entries; text passes through as-is.
 */
export async function invokeViaGenerateText(
  input: SnapshotInvokeInput,
): Promise<ChainAttemptOutcome> {
  const messages = [
    {
      role: 'user' as const,
      content: input.content.map(toAiSdkContentPart),
    },
  ]
  const result = await generateText({
    model: input.provider.languageModel(input.model, input.requestTimeoutMs),
    messages,
    abortSignal: input.signal,
  })
  return {
    summary: result.text,
    promptTokens: result.usage.inputTokens ?? 0,
    completionTokens: result.usage.outputTokens ?? 0,
    responseDump: {
      text: result.text,
      finishReason: result.finishReason,
      usage: result.usage,
    },
  }
}

function toAiSdkContentPart(
  item: ChatContentItem,
): { type: 'text'; text: string } | { type: 'file'; data: string; mediaType: string } {
  if (item.type === 'text') {
    return { type: 'text', text: item.text }
  }
  if (item.type === 'image_url') {
    return {
      type: 'file',
      data: item.imageUrl.url,
      mediaType: extractMediaType(item.imageUrl.url, 'image/jpeg'),
    }
  }
  if (item.type === 'input_video') {
    return {
      type: 'file',
      data: item.videoUrl.url,
      mediaType: extractMediaType(item.videoUrl.url, 'video/mp4'),
    }
  }
  throw new Error(
    `invokeViaGenerateText cannot serialize content of type "${(item as { type: string }).type}".`,
  )
}

function extractMediaType(dataUrl: string, fallback: string): string {
  const match = /^data:([^;]+);/.exec(dataUrl)
  return match ? match[1] : fallback
}

interface RawVideoCompletionInput {
  route: VendorRouteSnapshot
  model: string
  content: ChatContentItem[]
  signal: AbortSignal
  fetchImpl?: typeof globalThis.fetch
}

interface RawChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown
    }
  }>
  usage?: {
    promptTokens?: number
    completionTokens?: number
    prompt_tokens?: number
    completion_tokens?: number
  }
  error?: {
    code?: unknown
    message?: unknown
    details?: Array<{
      loc?: unknown
      msg?: unknown
      input?: unknown
      ctx?: unknown
    }>
  }
}

/**
 * Video pipeline only: posts an OpenAI-compatible chat completions request
 * directly. Bypasses the AI SDK because @ai-sdk/openai-compatible does not
 * support `input_video` content; OpenRouter (and some custom endpoints) do.
 */
export async function invokeRawVideoCompletion(
  input: RawVideoCompletionInput,
): Promise<ChainAttemptOutcome> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch
  const url = joinUrl(input.route.baseURL, '/chat/completions')
  const body = {
    model: input.model,
    messages: [
      {
        role: 'user',
        content: input.content.map(toVideoContentPart),
      },
    ],
  }
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (input.route.apiKey.length > 0) {
    headers.authorization = `Bearer ${input.route.apiKey}`
  }

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: input.signal,
    })
  } catch (error) {
    throw enrichRawHttpError(error)
  }

  let parsed: RawChatCompletionResponse | null = null
  let rawText = ''
  try {
    rawText = await response.text()
    parsed = rawText.length > 0 ? (JSON.parse(rawText) as RawChatCompletionResponse) : null
  } catch (error) {
    if (response.ok) {
      throw new Error(`Failed to parse response body: ${describe(error)}`)
    }
  }

  if (!response.ok) {
    const detail = parsed?.error
      ? buildErrorDetail(parsed.error)
      : rawText.length > 0
        ? rawText
        : `HTTP ${response.status}`
    throw new Error(`${response.status} ${response.statusText}${detail ? ` ${detail}` : ''}`)
  }

  if (!parsed) {
    throw new Error('Empty response body')
  }

  const summary = extractRawSummary(parsed)
  const usage = extractRawUsage(parsed)

  return {
    summary,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    responseDump: parsed,
  }
}

function toVideoContentPart(item: ChatContentItem): Record<string, unknown> {
  if (item.type === 'text') {
    return { type: 'text', text: item.text }
  }
  if (item.type === 'input_video') {
    return {
      type: 'input_video',
      video_url: { url: item.videoUrl.url },
    }
  }
  throw new Error(
    `invokeRawVideoCompletion does not serialize content of type "${item.type}". Use invokeViaGenerateText for text/image content.`,
  )
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base
  const trimmedPath = path.startsWith('/') ? path : `/${path}`
  return `${trimmedBase}${trimmedPath}`
}

function extractRawSummary(response: RawChatCompletionResponse): string {
  const content = response.choices?.[0]?.message?.content
  if (typeof content === 'string') {
    return content.trim()
  }
  if (Array.isArray(content)) {
    const textParts = content
      .map((part) => {
        if (!part || typeof part !== 'object') return ''
        const maybeText = (part as { text?: unknown }).text
        return typeof maybeText === 'string' ? maybeText : ''
      })
      .filter((value) => value.length > 0)
    return textParts.join(' ').trim()
  }
  return ''
}

function extractRawUsage(response: RawChatCompletionResponse): {
  promptTokens: number
  completionTokens: number
} {
  const usage = response.usage
  if (!usage) return { promptTokens: 0, completionTokens: 0 }
  return {
    promptTokens: usage.promptTokens ?? usage.prompt_tokens ?? 0,
    completionTokens: usage.completionTokens ?? usage.completion_tokens ?? 0,
  }
}

function buildErrorDetail(error: NonNullable<RawChatCompletionResponse['error']>): string {
  const parts: string[] = []
  if (typeof error.code === 'string' && error.code.length > 0) {
    parts.push(`code=${error.code}`)
  }
  if (typeof error.message === 'string' && error.message.length > 0) {
    parts.push(`provider_message=${error.message}`)
  }
  if (Array.isArray(error.details)) {
    for (const detail of error.details) {
      const loc = Array.isArray(detail.loc) ? detail.loc.join('.') : ''
      const msg = typeof detail.msg === 'string' ? detail.msg : ''
      const inputPreview =
        detail.input === undefined ? '' : ` input=${safeCompactJson(detail.input).slice(0, 200)}`
      const ctxPreview =
        detail.ctx === undefined ? '' : ` ctx=${safeCompactJson(detail.ctx).slice(0, 120)}`
      const fragment = [loc ? `loc=${loc}` : '', msg ? `msg=${msg}` : '', inputPreview, ctxPreview]
        .filter((value) => value.length > 0)
        .join(' ')
      if (fragment.length > 0) {
        parts.push(fragment)
      }
    }
  }
  return parts.join(' | ')
}

function enrichRawHttpError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(String(error))
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function safeCompactJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
