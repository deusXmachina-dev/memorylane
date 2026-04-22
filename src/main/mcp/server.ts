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
import { StorageService } from '../storage'
import { getDefaultDbPath } from '../paths'
import log from '../logger'
import { registerTools, type MCPServices } from './tools'
/* import { registerPrompts } from './prompts' */

const SERVER_NAME = 'memorylane'
const SERVER_VERSION = '1.0.0'

const SERVER_INSTRUCTIONS = `\
MemoryLane captures application sessions and stores one activity per session with \
an AI summary, OCR text, app metadata, and timestamp. Use it to recall past \
screen activity.

## How to reason about data (critical)

- **Use summaries for activity conclusions** — when answering "what the user did," \
ground conclusions in activity summaries from search_context or browse_timeline.
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
Results are ranked by semantic relevance and return summary-first context, including app and window title.
- **get_activity_details** — fetch full activity details including OCR screen text \
for specific activity IDs returned by the other tools. Use this only when exact \
on-screen text is needed; do not use OCR as the primary source for inferring user activity.
- **list_patterns** — show all detected workflow patterns with sighting counts. \
Use for "what patterns have you found?", "show my habits", or pattern review prompts.
- **search_patterns** — find patterns matching a keyword. Use when the user asks \
about patterns involving a specific app or workflow.
- **get_pattern_details** — drill into a specific pattern to see its evidence and \
sightings. Use after list_patterns or search_patterns.
- **get_user_context** — retrieve the auto-generated user profile for grounding context. \
Consider calling it early in a conversation for personalized responses, but don't \
over-anchor on it.

## Typical workflows

1. Activity question: browse_timeline or search_context → answer from summaries.
2. Exact-text question: search_context/browse_timeline → get_activity_details on key IDs → quote OCR text.
3. Drill-down: start broad with browse_timeline, then refine with search_context.
4. Mixed question: use summaries for narrative and OCR only for precise supporting details.
5. Automate patterns: list_patterns → get_pattern_details → write .claude/skills/ for each automatable pattern.

## Tips

- Combine time filters with semantic queries in search_context to narrow results.
- Use the appName filter when the user mentions a specific app ("in VS Code", "on Slack").
- When summarizing a time period, prefer uniform sampling to cover the full range.
- If summary and OCR seem to disagree, trust summary for "what happened" and treat OCR as raw evidence only.
- Activity IDs are opaque UUIDs — never fabricate them; always use IDs from tool results.`

export class MemoryLaneMCPServer {
  private server: McpServer
  private services: MCPServices | null = null

  constructor(services?: MCPServices) {
    this.services = services || null
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

    registerTools(
      this.server,
      () => this.services,
      (dbPath) => this.reinitializeWithDb(dbPath),
    )
    /* registerPrompts(this.server) */ // this is not handled by claude plugin
  }

  /**
   * Initializes services if they haven't been injected.
   *
   * Throws if storage or embedding init fails. Callers (the standalone CLI MCP
   * entry and `scripts/mcp-server.ts`) are expected to catch and present a
   * useful error — silently starting a half-alive server where every tool call
   * fails is more confusing than an outright startup failure.
   */
  private async initializeServices(dbPath?: string): Promise<void> {
    if (this.services) return

    // Use provided path or fall back to default
    const resolvedPath = dbPath || getDefaultDbPath()

    if (!fs.existsSync(resolvedPath)) {
      // Just a warning, not an error - database might be created on first write
      log.error(`Warning: Database path does not exist: ${resolvedPath}`)
    }

    log.error(`Initializing services with DB path: ${resolvedPath}`)

    const storage = new StorageService(resolvedPath)

    const { EmbeddingService } = await import('../processor/embedding')
    const embeddingService = new EmbeddingService()
    await embeddingService.init()

    this.services = { storage, embeddingService }
    log.error('Services initialized successfully')
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
   * Reinitializes services with a new database path.
   * Closes the existing storage connection and creates fresh services.
   */
  public async reinitializeWithDb(dbPath: string): Promise<void> {
    if (this.services) {
      try {
        this.services.storage.close()
      } catch {
        // ignore close errors
      }
    }
    this.services = null
    await this.initializeServices(dbPath)
  }

  /**
   * Get the underlying McpServer instance for testing or advanced usage.
   */
  public getServer(): McpServer {
    return this.server
  }
}

export default MemoryLaneMCPServer
