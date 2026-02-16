/**
 * MemoryLane MCP Server
 *
 * Exposes the context database to AI assistants via the Model Context Protocol.
 * Supports stdio transport for use with Claude Desktop, Cursor, and other MCP clients.
 */

// eslint-disable-next-line import/no-unresolved
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
// eslint-disable-next-line import/no-unresolved
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Writable } from 'node:stream'
import * as fs from 'fs'
import { EventProcessor } from '../processor/index'
import { StorageService } from '../processor/storage'
import { EmbeddingService } from '../processor/embedding'
import { getDefaultDbPath } from '../paths'
import log from '../logger'
import { registerTools } from './tools'
import { registerPrompts } from './prompts'

const SERVER_NAME = 'memorylane'
const SERVER_VERSION = '1.0.0'

const SERVER_INSTRUCTIONS = `\
MemoryLane captures application sessions and stores one event per session with \
an AI summary, OCR text, app metadata, and timestamp. Use it to recall past \
screen activity.

## How to reason about data (critical)

- **Use summaries for activity conclusions** — when answering "what the user did," \
ground conclusions in event summaries from search_context or browse_timeline.
- **Use OCR for exact recall only** — use OCR only when the user needs exact strings \
(file names, error messages, copied text, specific wording).
- **Never infer activity from OCR alone** — OCR is ambiguous: it may include passive \
reading, user-authored text, third-party content, ads, or notifications.

## Choosing the right tool

- **browse_timeline** — open-ended questions like "what did I do today?", \
"summarize my morning", or "what was I working on last Friday?". Use higher \
limits since each result is a compact one-line summary suitable for activity \
reasoning. \
10-100 is a good default limit for searches over less than 30 minutes. \
100-500 is a good default limit for searches over many hours.
- **search_context** — targeted recall like "when did I review PR #142?", \
"find my work on the auth module", or "that error I saw in the terminal". \
Results are ranked by semantic relevance and return summary-first context.
- **get_event_details** — fetch full OCR screen text for specific event IDs \
returned by the other tools. Use this only when exact on-screen text is needed; \
do not use OCR as the primary source for inferring user activity.

## Typical workflows

1. Activity question: browse_timeline or search_context → answer from summaries.
2. Exact-text question: search_context/browse_timeline → get_event_details on key IDs → quote OCR text.
3. Drill-down: start broad with browse_timeline, then refine with search_context.
4. Mixed question: use summaries for narrative and OCR only for precise supporting details.

## Tips

- Combine time filters with semantic queries in search_context to narrow results.
- Use the appName filter when the user mentions a specific app ("in VS Code", "on Slack").
- When summarizing a time period, prefer uniform sampling to cover the full range.
- If summary and OCR seem to disagree, trust summary for "what happened" and treat OCR as raw evidence only.
- Event IDs are opaque UUIDs — never fabricate them; always use IDs from tool results.`

export class MemoryLaneMCPServer {
  private server: McpServer
  private eventProcessor: EventProcessor | null = null

  constructor(eventProcessor?: EventProcessor) {
    this.eventProcessor = eventProcessor || null
    this.server = new McpServer(
      {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
      {
        instructions: SERVER_INSTRUCTIONS,
        capabilities: {
          tools: {},
          prompts: {},
        },
      },
    )

    registerTools(this.server, () => this.eventProcessor)
    registerPrompts(this.server)
  }

  /**
   * Initializes services if they haven't been injected.
   */
  private async initializeServices(dbPath?: string): Promise<void> {
    if (this.eventProcessor) return

    // Use provided path or fall back to default
    const resolvedPath = dbPath || getDefaultDbPath()

    try {
      if (!fs.existsSync(resolvedPath)) {
        // Just a warning, not an error - database might be created on first write
        log.error(`Warning: Database path does not exist: ${resolvedPath}`)
      }

      log.error(`Initializing services with DB path: ${resolvedPath}`)

      const storageService = new StorageService(resolvedPath)
      await storageService.init()

      const embeddingService = new EmbeddingService()
      await embeddingService.init()

      this.eventProcessor = new EventProcessor(embeddingService, storageService)
      log.error('Services initialized successfully')
    } catch (error) {
      log.error('Failed to initialize services:', error)
      // We allow the server to start even if services fail, but tools will report errors
    }
  }

  /**
   * Start the MCP server with stdio transport.
   *
   * @param dbPath - Optional database path override.
   * @param stdout - Optional writable stream for the transport's stdout.
   *                 When provided, the transport writes JSON-RPC to this stream
   *                 instead of process.stdout, allowing the caller to redirect
   *                 process.stdout to stderr so no other module can pollute
   *                 the MCP channel.
   */
  public async start(dbPath?: string, stdout?: Writable): Promise<void> {
    await this.initializeServices(dbPath)

    const transport = new StdioServerTransport(process.stdin, stdout ?? process.stdout)
    await this.server.connect(transport)

    log.error(`${SERVER_NAME} MCP server started`)
  }

  /**
   * Get the underlying McpServer instance for testing or advanced usage.
   */
  public getServer(): McpServer {
    return this.server
  }
}

export default MemoryLaneMCPServer
