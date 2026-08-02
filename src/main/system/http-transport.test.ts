import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Agent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureHttpTransport } from './http-transport'
import { MAX_REQUEST_TIMEOUT_MS, TRANSPORT_TIMEOUT_MS } from '../../shared/constants'

describe('configureHttpTransport', () => {
  // undici's timer wheel has a ~1s floor and a ~500ms tick, so the short guard
  // below fires around 1s — the stall has to outlast that to be observable.
  const HEADER_DELAY_MS = 2500
  let server: Server
  let url: string
  let original: Dispatcher

  beforeEach(async () => {
    original = getGlobalDispatcher()
    server = createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('ok')
      }, HEADER_DELAY_MS)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  })

  afterEach(async () => {
    setGlobalDispatcher(original)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  // Scale model of issue #268 at 1s/2.5s instead of 300s/60min: a global
  // headers guard shorter than the work kills a request that is still running.
  it('lifts a global headers guard that would kill a slow response', async () => {
    setGlobalDispatcher(new Agent({ headersTimeout: 500 }))
    await expect(fetch(url)).rejects.toMatchObject({
      cause: { code: 'UND_ERR_HEADERS_TIMEOUT' },
    })

    configureHttpTransport()
    expect((await fetch(url)).status).toBe(200)
  })

  it('leaves the caller-supplied deadline in charge', async () => {
    configureHttpTransport()
    await expect(fetch(url, { signal: AbortSignal.timeout(500) })).rejects.toMatchObject({
      name: 'TimeoutError',
    })
  })

  it('outlives any deadline the app can be configured with', () => {
    expect(TRANSPORT_TIMEOUT_MS).toBeGreaterThan(MAX_REQUEST_TIMEOUT_MS)
  })
})
