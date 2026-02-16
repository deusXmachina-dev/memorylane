// eslint-disable-next-line import/no-unresolved
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { EventProcessor } from '../processor/index'
import { parseTimeString } from './parse-time'
import { formatEventLine, sampleEvents, deduplicateResults } from './formatting'
import log from '../logger'

export const SEARCH_CONTEXT_TOOL_NAME = 'search_context'
export const BROWSE_TIMELINE_TOOL_NAME = 'browse_timeline'
export const GET_EVENT_DETAILS_TOOL_NAME = 'get_event_details'

export const SEARCH_CONTEXT_DESCRIPTION =
  'Semantic search over recorded screen activity. Results are summary-first and ranked by relevance. ' +
  'Use this for targeted activity recall (e.g. "when did I review PR #142?"). ' +
  'If query is omitted, returns events chronologically (requires startTime or endTime). ' +
  'For exact strings, call get_event_details to inspect OCR text.'

export const BROWSE_TIMELINE_DESCRIPTION =
  'List activity during a time period for broad recall ("what did I do today?"). ' +
  'Each result is a compact summary line (id, timestamp, app, summary). ' +
  'Use summaries to infer activity; call get_event_details only when exact OCR text is needed.'

export const GET_EVENT_DETAILS_DESCRIPTION =
  'Fetch full event details by ID, including raw OCR text. Use this for exact recall only ' +
  '(quotes, file names, commands, or error strings), not for inferring user activity.'

/**
 * Registers all MCP tools on the given server.
 *
 * @param server - The MCP server instance to register tools on.
 * @param getProcessor - Lazy accessor for the EventProcessor (may be null before initialization).
 */
export function registerTools(server: McpServer, getProcessor: () => EventProcessor | null): void {
  server.registerTool(
    SEARCH_CONTEXT_TOOL_NAME,
    {
      description: SEARCH_CONTEXT_DESCRIPTION,
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe(
            'Semantic search query. When provided, results are ranked by relevance. When omitted, results are returned chronologically (requires at least startTime or endTime).',
          ),
        limit: z.number().optional().describe('Maximum number of results to return (default: 100)'),
        startTime: z
          .string()
          .optional()
          .describe(
            'Filter: only include results after this time. Accepts ISO 8601 (e.g., "2024-01-15T10:00:00") or relative time strings (e.g., "1 hour ago", "yesterday", "2 days ago")',
          ),
        endTime: z
          .string()
          .optional()
          .describe(
            'Filter: only include results before this time. Accepts ISO 8601 (e.g., "2024-01-15T18:00:00") or relative time strings (e.g., "now", "1 hour ago")',
          ),
        appName: z
          .string()
          .optional()
          .describe(
            'Filter: only include results from this application (e.g., "VS Code", "Chrome", "Slack")',
          ),
      },
    },
    (params) => handleSearchContext(getProcessor(), params),
  )

  server.registerTool(
    BROWSE_TIMELINE_TOOL_NAME,
    {
      description: BROWSE_TIMELINE_DESCRIPTION,
      inputSchema: {
        startTime: z
          .string()
          .describe(
            'Start of time range. Accepts ISO 8601 (e.g., "2024-01-15T10:00:00") or relative strings (e.g., "1 hour ago", "yesterday", "2 days ago")',
          ),
        endTime: z
          .string()
          .describe(
            'End of time range. Accepts ISO 8601 (e.g., "2024-01-15T18:00:00") or relative strings (e.g., "now", "1 hour ago")',
          ),
        appName: z
          .string()
          .optional()
          .describe(
            'Filter: only include results from this application (e.g., "VS Code", "Chrome", "Slack")',
          ),
        limit: z.number().optional().describe('Maximum number of results to return (default: 100)'),
        sampling: z
          .enum(['uniform', 'recent_first'])
          .optional()
          .describe(
            'How to sample when there are more events than the limit. "uniform" picks evenly spaced entries across the range (default). "recent_first" returns the newest entries.',
          ),
      },
    },
    (params) => handleBrowseTimeline(getProcessor(), params),
  )

  server.registerTool(
    GET_EVENT_DETAILS_TOOL_NAME,
    {
      description: GET_EVENT_DETAILS_DESCRIPTION,
      inputSchema: {
        ids: z
          .array(z.string())
          .min(1)
          .max(100)
          .describe('Event IDs to fetch (from search_context or browse_timeline results)'),
      },
    },
    (params) => handleGetEventDetails(getProcessor(), params),
  )
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleSearchContext(
  processor: EventProcessor | null,
  {
    query,
    limit,
    startTime: startTimeStr,
    endTime: endTimeStr,
    appName,
  }: {
    query?: string | undefined
    limit?: number | undefined
    startTime?: string | undefined
    endTime?: string | undefined
    appName?: string | undefined
  },
) {
  if (!processor) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Error: EventProcessor is not initialized. The server cannot search the database.',
        },
      ],
      isError: true,
    }
  }

  try {
    const effectiveLimit = limit ?? 100

    const startTime = startTimeStr ? parseTimeString(startTimeStr) : undefined
    const endTime = endTimeStr ? parseTimeString(endTimeStr) : undefined

    if (startTimeStr && startTime === null) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: Could not parse startTime "${startTimeStr}". Use ISO 8601 format or relative strings like "1 hour ago", "yesterday", etc.`,
          },
        ],
        isError: true,
      }
    }

    if (endTimeStr && endTime === null) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: Could not parse endTime "${endTimeStr}". Use ISO 8601 format or relative strings like "now", "1 hour ago", etc.`,
          },
        ],
        isError: true,
      }
    }

    // No query: fall back to chronological time-range listing
    if (!query) {
      if (startTime === undefined && endTime === undefined) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: Either query or at least one of startTime/endTime is required.',
            },
          ],
          isError: true,
        }
      }

      const storage = processor.getStorageService()
      const events = await storage.getEventsByTimeRange(startTime ?? null, endTime ?? null, {
        appName,
      })

      const sampled = sampleEvents(events, effectiveLimit, 'recent_first')

      if (sampled.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No events found in the given time range.' }],
        }
      }

      const formatted = sampled.map(formatEventLine).join('\n')

      const header =
        sampled.length < events.length
          ? `Showing ${sampled.length} of ${events.length} events:`
          : `${events.length} event(s):`

      return {
        content: [{ type: 'text' as const, text: `${header}\n\n${formatted}` }],
      }
    }

    // Semantic search path
    const results = await processor.search(query, {
      limit: effectiveLimit,
      startTime: startTime ?? undefined,
      endTime: endTime ?? undefined,
      appName,
    })

    const combinedResults = deduplicateResults(results.vector, results.fts)

    if (combinedResults.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No relevant context found.',
          },
        ],
      }
    }

    const formattedResults = combinedResults.map(formatEventLine).join('\n')

    return {
      content: [
        {
          type: 'text' as const,
          text: `Found ${combinedResults.length} relevant events:\n\n${formattedResults}`,
        },
      ],
    }
  } catch (error) {
    log.error('Error searching context:', error)
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error performing search: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }
}

async function handleBrowseTimeline(
  processor: EventProcessor | null,
  {
    startTime: startTimeStr,
    endTime: endTimeStr,
    appName,
    limit,
    sampling,
  }: {
    startTime: string
    endTime: string
    appName?: string | undefined
    limit?: number | undefined
    sampling?: 'uniform' | 'recent_first' | undefined
  },
) {
  if (!processor) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Error: EventProcessor is not initialized. The server cannot query the database.',
        },
      ],
      isError: true,
    }
  }

  try {
    const startTime = parseTimeString(startTimeStr)
    const endTime = parseTimeString(endTimeStr)

    if (startTime === null) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: Could not parse startTime "${startTimeStr}". Use ISO 8601 format or relative strings like "1 hour ago", "yesterday", etc.`,
          },
        ],
        isError: true,
      }
    }

    if (endTime === null) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: Could not parse endTime "${endTimeStr}". Use ISO 8601 format or relative strings like "now", "1 hour ago", etc.`,
          },
        ],
        isError: true,
      }
    }

    const storage = processor.getStorageService()
    const allEvents = await storage.getEventsByTimeRange(startTime, endTime, { appName })

    if (allEvents.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No events found in the given time range.',
          },
        ],
      }
    }

    const effectiveLimit = limit ?? 100
    const effectiveSampling = sampling ?? 'uniform'
    const sampled = sampleEvents(allEvents, effectiveLimit, effectiveSampling)

    const formatted = sampled.map(formatEventLine).join('\n')

    const header =
      sampled.length < allEvents.length
        ? `Showing ${sampled.length} of ${allEvents.length} events (${effectiveSampling} sampling):`
        : `${allEvents.length} event(s):`

    return {
      content: [
        {
          type: 'text' as const,
          text: `${header}\n\n${formatted}`,
        },
      ],
    }
  } catch (error) {
    log.error('Error browsing timeline:', error)
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error browsing timeline: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }
}

async function handleGetEventDetails(processor: EventProcessor | null, { ids }: { ids: string[] }) {
  if (!processor) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Error: EventProcessor is not initialized. The server cannot query the database.',
        },
      ],
      isError: true,
    }
  }

  try {
    const storage = processor.getStorageService()
    const events = await storage.getEventsByIds(ids)

    if (events.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No events found for the given IDs.',
          },
        ],
      }
    }

    const formatted = events
      .map((e) => {
        const timeStr = new Date(e.timestamp).toLocaleString()
        const appInfo = e.appName ? ` [${e.appName}]` : ''
        const summaryLine = e.summary ? `\nSummary: ${e.summary}` : ''
        return `ID: ${e.id}\n[${timeStr}]${appInfo}${summaryLine}\nOCR: ${e.text}`
      })
      .join('\n\n---\n\n')

    return {
      content: [
        {
          type: 'text' as const,
          text: `${events.length} event(s):\n\n${formatted}`,
        },
      ],
    }
  } catch (error) {
    log.error('Error fetching event details:', error)
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error fetching event details: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }
}
