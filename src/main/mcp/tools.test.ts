import { describe, expect, it } from 'vitest'
// eslint-disable-next-line import/no-unresolved
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTools, type EditionContext } from './tools'

type Handler = (args: unknown) => Promise<{ content: { type: string; text: string }[] }>

function registerWithMockServer(ctx: EditionContext): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const mockServer = {
    registerTool: (name: string, _meta: unknown, handler: Handler): void => {
      handlers.set(name, handler)
    },
  } as unknown as McpServer

  registerTools(
    mockServer,
    () => null,
    async () => {},
    () => ctx,
  )
  return handlers
}

describe('get_db_path tool', () => {
  it('reports the enterprise default path when edition is enterprise', async () => {
    const ctx: EditionContext = {
      edition: 'enterprise',
      source: 'default',
      currentDbPath: '/example/MemoryLane Enterprise/memorylane.db',
    }
    const handlers = registerWithMockServer(ctx)
    const handler = handlers.get('get_db_path')
    expect(handler).toBeDefined()

    const result = await handler!({})
    const payload = JSON.parse(result.content[0].text)

    expect(payload.edition).toBe('enterprise')
    expect(payload.source).toBe('default')
    expect(payload.path).toBe(ctx.currentDbPath)
    expect(payload.defaultForEdition).toMatch(
      /MemoryLane Enterprise(-dev)?[\\/]memorylane(-dev)?\.db$/,
    )
  })

  it('reports the customer default when edition is customer, and echoes the source', async () => {
    const ctx: EditionContext = {
      edition: 'customer',
      source: 'flag',
      currentDbPath: '/tmp/custom.db',
    }
    const handlers = registerWithMockServer(ctx)
    const handler = handlers.get('get_db_path')!

    const result = await handler({})
    const payload = JSON.parse(result.content[0].text)

    expect(payload.edition).toBe('customer')
    expect(payload.source).toBe('flag')
    expect(payload.path).toBe('/tmp/custom.db')
    expect(payload.defaultForEdition).not.toMatch(/Enterprise/)
    expect(payload.defaultForEdition).toMatch(/MemoryLane(-dev)?[\\/]memorylane(?:-dev)?\.db$/)
  })
})
