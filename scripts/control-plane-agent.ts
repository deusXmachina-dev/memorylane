#!/usr/bin/env npx tsx
import { StorageService } from '../src/main/storage'
import { EmbeddingService } from '../src/main/processor/embedding'
import { getDefaultDbPath } from '../src/main/paths'
import { executeMCPTool, type MCPToolName } from '../src/main/mcp/tools'

interface PollRequest {
  request_id: string
  tool_name: MCPToolName
  tool_input: unknown
  created_at: number
}

interface PollResponse {
  request: PollRequest | null
}

const CONTROL_PLANE_URL = (process.env.CONTROL_PLANE_URL ?? 'http://127.0.0.1:8787').replace(
  /\/$/,
  '',
)
const DEVICE_TOKEN = process.env.CONTROL_PLANE_DEVICE_TOKEN ?? ''
const DB_PATH = process.env.MEMORYLANE_DB_PATH ?? getDefaultDbPath()
const POLL_TIMEOUT_MS = Math.max(
  1_000,
  Number.parseInt(process.env.CONTROL_PLANE_POLL_TIMEOUT_MS ?? '25000', 10),
)
const IDLE_SLEEP_MS = 250

if (!DEVICE_TOKEN) {
  throw new Error('Missing CONTROL_PLANE_DEVICE_TOKEN')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${CONTROL_PLANE_URL}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${DEVICE_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function main(): Promise<void> {
  const storage = new StorageService(DB_PATH)
  const embeddingService = new EmbeddingService()

  // eslint-disable-next-line no-console
  console.log(`[control-plane-agent] connected to ${CONTROL_PLANE_URL}`)
  // eslint-disable-next-line no-console
  console.log(`[control-plane-agent] db=${DB_PATH}`)

  let stopped = false
  const stop = (): void => {
    stopped = true
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  try {
    while (!stopped) {
      const pollRes = await postJson('/tunnel/poll', { timeout_ms: POLL_TIMEOUT_MS })

      if (!pollRes.ok) {
        // eslint-disable-next-line no-console
        console.error(`[control-plane-agent] poll failed: ${pollRes.status}`)
        await sleep(1_000)
        continue
      }

      const pollBody = (await pollRes.json()) as PollResponse
      const request = pollBody.request
      if (!request) {
        await sleep(IDLE_SLEEP_MS)
        continue
      }

      let result: unknown = null
      let error: string | undefined

      try {
        const toolResult = await executeMCPTool(
          {
            storage,
            embeddingService,
          },
          request.tool_name,
          request.tool_input,
        )

        if (toolResult.isError) {
          error =
            toolResult.content[0]?.text ??
            `Tool ${request.tool_name} failed without explicit error message`
        } else {
          result = toolResult
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
      }

      const respondRes = await postJson('/tunnel/respond', {
        request_id: request.request_id,
        result,
        error,
      })

      if (!respondRes.ok) {
        // eslint-disable-next-line no-console
        console.error(`[control-plane-agent] respond failed: ${respondRes.status}`)
      }
    }
  } finally {
    storage.close()
  }
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[control-plane-agent] fatal error:', error)
  process.exit(1)
})
