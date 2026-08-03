import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { generateText } from 'ai'
import { Agent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSdkProvider } from './adapters'

/**
 * Issue #268 end to end, scaled to seconds: an endpoint that takes longer to
 * answer than undici's guard allows, driven through the real AI SDK path.
 * STALL_MS stands in for a local model still generating; the guards below stand
 * in for undici's 300s default and the configured task-mining deadline. undici's
 * timer wheel has a ~1s floor and a ~500ms tick, so the 500ms guard fires around
 * 1s — the stall has to outlast that to be observable.
 */
const STALL_MS = 2500

describe('LLM request deadline', () => {
  let server: Server
  let baseURL: string
  let original: Dispatcher

  beforeEach(async () => {
    original = getGlobalDispatcher()
    server = createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            id: 'c1',
            choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        )
      }, STALL_MS)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  })

  afterEach(async () => {
    setGlobalDispatcher(original)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  const scan = (timeout: number): Promise<unknown> =>
    generateText({
      model: createSdkProvider('openai-compatible', {
        apiKey: 'sk-test',
        baseURL,
      }).languageModel('local-model'),
      prompt: 'summarize the day',
      maxRetries: 0,
      timeout,
    })

  it('reproduces the bug: a transport guard under the deadline kills live work', async () => {
    setGlobalDispatcher(new Agent({ headersTimeout: 500, bodyTimeout: 500 }))
    await expect(scan(30_000)).rejects.toMatchObject({
      cause: expect.objectContaining({ code: 'UND_ERR_HEADERS_TIMEOUT' }),
    })
  })

  it('completes the same work once the guard sits above the deadline', async () => {
    setGlobalDispatcher(new Agent({ headersTimeout: 30_000, bodyTimeout: 30_000 }))
    await expect(scan(10_000)).resolves.toMatchObject({ text: 'done' })
  })

  it('still fails on the configured deadline when the endpoint is slower', async () => {
    setGlobalDispatcher(new Agent({ headersTimeout: 30_000, bodyTimeout: 30_000 }))
    const startedAt = Date.now()
    await expect(scan(500)).rejects.toThrow()
    expect(Date.now() - startedAt).toBeLessThan(STALL_MS)
  })
})
