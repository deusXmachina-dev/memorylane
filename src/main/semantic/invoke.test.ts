import { describe, it, expect, vi } from 'vitest'
import { generateText } from 'ai'
import { invokeRawVideoCompletion, invokeViaGenerateText } from './invoke'
import type { InferenceProvider, VendorRouteSnapshot } from '../llm'
import type { ChatContentItem } from './types'

vi.mock('ai', () => ({ generateText: vi.fn() }))

function makeRoute(overrides: Partial<VendorRouteSnapshot> = {}): VendorRouteSnapshot {
  return {
    vendor: 'openrouter',
    baseURL: 'https://example.test/v1',
    apiKey: 'sk-test',
    ...overrides,
  }
}

const VIDEO_CONTENT: ChatContentItem[] = [
  { type: 'text', text: 'summarize' },
  { type: 'input_video', videoUrl: { url: 'data:video/mp4;base64,AAAA' } },
]

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

describe('invokeViaGenerateText', () => {
  it('passes requestTimeoutMs through to languageModel', async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: 'ok',
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: 'stop',
    } as never)
    const languageModel = vi.fn<InferenceProvider['languageModel']>().mockReturnValue('model')
    const provider: InferenceProvider = {
      isConfigured: () => true,
      getActiveVendor: () => 'openrouter',
      languageModel,
      getRouteSnapshot: () => null,
      notifyConfigChanged: () => {},
      onConfigChanged: () => () => {},
    }

    await invokeViaGenerateText({
      provider,
      model: 'm',
      content: [{ type: 'text', text: 'hi' }],
      signal: new AbortController().signal,
      requestTimeoutMs: 120_000,
    })

    expect(languageModel).toHaveBeenCalledWith('m', 120_000)
  })
})

describe('invokeRawVideoCompletion', () => {
  it('parses a successful chat-completion response', async () => {
    const fetchImpl: typeof globalThis.fetch = async () =>
      jsonResponse({
        choices: [{ message: { content: 'a summary' } }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      })

    const outcome = await invokeRawVideoCompletion({
      route: makeRoute(),
      model: 'm',
      content: VIDEO_CONTENT,
      signal: new AbortController().signal,
      requestTimeoutMs: 120_000,
      fetchImpl,
    })

    expect(outcome.summary).toBe('a summary')
    expect(outcome.promptTokens).toBe(10)
    expect(outcome.completionTokens).toBe(4)
  })

  it('formats structured error responses with code/provider_message details', async () => {
    const fetchImpl: typeof globalThis.fetch = async () =>
      jsonResponse(
        {
          error: {
            code: 'invalid_input',
            message: 'video too large',
            details: [{ loc: ['body', 'messages'], msg: 'unsupported', input: { foo: 1 } }],
          },
        },
        { status: 400, statusText: 'Bad Request' },
      )

    await expect(
      invokeRawVideoCompletion({
        route: makeRoute(),
        model: 'm',
        content: VIDEO_CONTENT,
        signal: new AbortController().signal,
        requestTimeoutMs: 120_000,
        fetchImpl,
      }),
    ).rejects.toThrow(/code=invalid_input/)
  })

  it('falls back to raw response text on a non-OK non-JSON body', async () => {
    const fetchImpl: typeof globalThis.fetch = async () =>
      new Response('upstream is down', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'content-type': 'text/plain' },
      })

    await expect(
      invokeRawVideoCompletion({
        route: makeRoute(),
        model: 'm',
        content: VIDEO_CONTENT,
        signal: new AbortController().signal,
        requestTimeoutMs: 120_000,
        fetchImpl,
      }),
    ).rejects.toThrow(/upstream is down/)
  })

  it('throws "Empty response body" when an OK response has no body', async () => {
    const fetchImpl: typeof globalThis.fetch = async () => new Response('', { status: 200 })

    await expect(
      invokeRawVideoCompletion({
        route: makeRoute(),
        model: 'm',
        content: VIDEO_CONTENT,
        signal: new AbortController().signal,
        requestTimeoutMs: 120_000,
        fetchImpl,
      }),
    ).rejects.toThrow(/Empty response body/)
  })

  it('propagates fetch errors (e.g. abort/network)', async () => {
    const fetchImpl: typeof globalThis.fetch = async () => {
      throw new Error('aborted by test')
    }

    await expect(
      invokeRawVideoCompletion({
        route: makeRoute(),
        model: 'm',
        content: VIDEO_CONTENT,
        signal: new AbortController().signal,
        requestTimeoutMs: 120_000,
        fetchImpl,
      }),
    ).rejects.toThrow(/aborted by test/)
  })

  it('rejects content types that are not text or input_video', async () => {
    const fetchImpl: typeof globalThis.fetch = async () =>
      jsonResponse({
        choices: [{ message: { content: 'ok' } }],
      })

    await expect(
      invokeRawVideoCompletion({
        route: makeRoute(),
        model: 'm',
        content: [
          { type: 'image_url', imageUrl: { url: 'data:image/png;base64,XX', detail: 'high' } },
        ],
        signal: new AbortController().signal,
        requestTimeoutMs: 120_000,
        fetchImpl,
      }),
    ).rejects.toThrow(/does not serialize content of type "image_url"/)
  })

  it('omits the Authorization header when apiKey is empty (Ollama case)', async () => {
    let seenHeaders: Record<string, string> | null = null
    const fetchImpl: typeof globalThis.fetch = async (_url, init) => {
      seenHeaders = (init?.headers as Record<string, string>) ?? {}
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
    }

    await invokeRawVideoCompletion({
      route: makeRoute({ apiKey: '' }),
      model: 'm',
      content: VIDEO_CONTENT,
      signal: new AbortController().signal,
      requestTimeoutMs: 120_000,
      fetchImpl,
    })

    expect(seenHeaders).not.toBeNull()
    expect(seenHeaders!.authorization).toBeUndefined()
  })
})
