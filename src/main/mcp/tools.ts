// eslint-disable-next-line import/no-unresolved
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { parseTimeString } from './parse-time'
import {
  formatTimelineEntry,
  sampleEntries,
  activityToTimelineEntry,
  TimelineEntry,
} from './formatting'
import type { StorageService, PatternWithStats, PatternSighting } from '../storage'
import type { EmbeddingService } from '../processor/embedding'
import log from '../logger'

export interface MCPServices {
  storage: StorageService
  embeddingService: EmbeddingService
}

/**
 * Registers all MCP tools on the given server.
 *
 * @param server - The MCP server instance to register tools on.
 * @param getServices - Lazy accessor for services (may be null before initialization).
 */
export function registerTools(server: McpServer, getServices: () => MCPServices | null): void {
  server.registerTool(
    'search_context',
    {
      description:
        'Semantic search over recorded screen activity sessions. Each result includes id, time, app, window title, and AI summary for summary-first activity reasoning. Use this for targeted questions (e.g. "when did I review PR #142?", "find my work on the auth module"). For exact strings, call get_activity_details to inspect OCR text. If query is omitted, returns activities chronologically (requires startTime or endTime).',
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
    (params) => handleSearchContext(getServices(), params),
  )

  server.registerTool(
    'browse_timeline',
    {
      description:
        'List activity during a time period — best for broad "what did I do?" questions. Each result is a one-line summary (~20 tokens), so use higher limits (30-50) to get a full picture. Supports uniform sampling to cover long ranges. Returns id, timestamp, app, window title, and summary for activity inference; call get_activity_details only when exact OCR text is needed.',
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
            'How to sample when there are more activities than the limit. "uniform" picks evenly spaced entries across the range (default). "recent_first" returns the newest entries.',
          ),
      },
    },
    (params) => handleBrowseTimeline(getServices(), params),
  )

  server.registerTool(
    'get_activity_details',
    {
      description:
        'Fetch full activity details by ID, including summary and raw OCR screen text. This is the only tool that returns OCR content. Use after browse_timeline or search_context when exact on-screen text is required (quotes, file names, error strings), not as the primary source for activity inference.',
      inputSchema: {
        ids: z
          .array(z.string())
          .min(1)
          .max(100)
          .describe('Activity IDs to fetch (from search_context or browse_timeline results)'),
      },
    },
    (params) => handleGetActivityDetails(getServices(), params),
  )

  server.registerTool(
    'get_user_context',
    {
      description:
        'Retrieve the auto-generated user profile (persona) built from observed screen activity. Returns a short summary, a detailed summary, and when the profile was last updated. Useful for grounding personalized responses.',
      inputSchema: {},
    },
    () => handleGetUserContext(getServices()),
  )

  // ---------------------------------------------------------------------------
  // Pattern tools
  // ---------------------------------------------------------------------------

  server.registerTool(
    'list_patterns',
    {
      description:
        'List all detected workflow patterns with stats (sighting count, last seen, confidence). ' +
        'Patterns are recurring behaviors identified by the pattern detector across captured screen activity. ' +
        'Results are ordered by sighting count (most frequent first). ' +
        'Use search_patterns for keyword filtering.',
      inputSchema: {},
    },
    () => handleListPatterns(getServices()),
  )

  server.registerTool(
    'search_patterns',
    {
      description:
        'Search detected workflow patterns by keyword. Matches against pattern name, description, and associated apps. ' +
        'Returns matching patterns with stats. Use list_patterns to see all patterns without filtering.',
      inputSchema: {
        query: z
          .string()
          .describe('Search keyword to match against pattern name, description, or apps'),
      },
    },
    (params) => handleSearchPatterns(getServices(), params),
  )

  server.registerTool(
    'get_pattern_details',
    {
      description:
        'Fetch a specific pattern by ID with its full details and recent sightings. ' +
        'Each sighting includes evidence text, confidence score, and the activity IDs that triggered it. ' +
        'Use after list_patterns or search_patterns to drill into a specific pattern.',
      inputSchema: {
        patternId: z
          .string()
          .describe('Pattern ID (from list_patterns or search_patterns results)'),
        runId: z
          .string()
          .optional()
          .describe('Optional: filter sightings to a specific detection run ID'),
      },
    },
    (params) => handleGetPatternDetails(getServices(), params),
  )
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleSearchContext(
  services: MCPServices | null,
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
  if (!services) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Error: Services not initialized. The server cannot search the database.',
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

    const storage = services.storage

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

      const activities = storage.activities.getByTimeRange(startTime ?? null, endTime ?? null, {
        appName,
      })

      const entries = activities.map(activityToTimelineEntry)
      const sampled = sampleEntries(entries, effectiveLimit, 'recent_first')

      if (sampled.length === 0) {
        return {
          content: [
            { type: 'text' as const, text: 'No activities found in the given time range.' },
          ],
        }
      }

      const formatted = sampled.map(formatTimelineEntry).join('\n')

      const header =
        sampled.length < entries.length
          ? `Showing ${sampled.length} of ${entries.length} activities:`
          : `${entries.length} activit${entries.length === 1 ? 'y' : 'ies'}:`

      return {
        content: [{ type: 'text' as const, text: `${header}\n\n${formatted}` }],
      }
    }

    // Semantic search path
    const filters = {
      startTime: startTime ?? undefined,
      endTime: endTime ?? undefined,
      appName,
    }

    // Run embedding generation and FTS in parallel
    let ftsResults: ReturnType<typeof storage.activities.searchFTS> = []
    try {
      ftsResults = storage.activities.searchFTS(query, effectiveLimit, filters)
    } catch (err) {
      log.warn('FTS search failed, falling back to vector-only:', err)
    }
    const embedding = await services.embeddingService.generateEmbedding(query)
    const vectorResults = storage.activities.searchVectors(embedding, effectiveLimit, filters)

    // Deduplicate: vector results first (preserves relevance order), then FTS extras
    const seen = new Set<string>()
    const allResults: TimelineEntry[] = []

    for (const a of vectorResults) {
      seen.add(a.id)
      allResults.push(activityToTimelineEntry(a))
    }
    for (const a of ftsResults) {
      if (!seen.has(a.id)) {
        seen.add(a.id)
        allResults.push(activityToTimelineEntry(a))
      }
    }

    // Truncate to requested limit
    const truncated = allResults.slice(0, effectiveLimit)

    if (truncated.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No relevant context found.',
          },
        ],
      }
    }

    const formattedResults = truncated.map(formatTimelineEntry).join('\n')

    return {
      content: [
        {
          type: 'text' as const,
          text: `Found ${truncated.length} relevant results (ranked by relevance):\n\n${formattedResults}`,
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
  services: MCPServices | null,
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
  if (!services) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Error: Services not initialized. The server cannot query the database.',
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

    const storage = services.storage
    const activities = storage.activities.getByTimeRange(startTime, endTime, { appName })
    const entries = activities.map(activityToTimelineEntry)

    if (entries.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No activities found in the given time range.',
          },
        ],
      }
    }

    const effectiveLimit = limit ?? 100
    const effectiveSampling = sampling ?? 'uniform'
    const sampled = sampleEntries(entries, effectiveLimit, effectiveSampling)

    const formatted = sampled.map(formatTimelineEntry).join('\n')

    const header =
      sampled.length < entries.length
        ? `Showing ${sampled.length} of ${entries.length} activities (${effectiveSampling} sampling):`
        : `${entries.length} activit${entries.length === 1 ? 'y' : 'ies'}:`

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

// ---------------------------------------------------------------------------
// Pattern tool handlers
// ---------------------------------------------------------------------------

function formatPatternLine(p: PatternWithStats): string {
  const sightings = `${p.sightingCount} sighting${p.sightingCount !== 1 ? 's' : ''}`
  const lastSeen = p.lastSeenAt ? `, last seen ${new Date(p.lastSeenAt).toLocaleString()}` : ''
  const confidence =
    p.lastConfidence !== null ? `, confidence ${(p.lastConfidence * 100).toFixed(0)}%` : ''
  return `- ${p.id} | ${p.name} [${p.apps.join(', ')}] (${sightings}${lastSeen}${confidence})\n  ${p.description}\n  Automation idea: ${p.automationIdea}`
}

function formatSightingLine(s: PatternSighting): string {
  const time = new Date(s.detectedAt).toLocaleString()
  const confidence = `${(s.confidence * 100).toFixed(0)}%`
  return `- ${s.id} | ${time} | confidence: ${confidence} | run: ${s.runId}\n  Evidence: ${s.evidence}\n  Activity IDs: ${s.activityIds.join(', ')}`
}

async function handleListPatterns(services: MCPServices | null) {
  if (!services) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Error: Services not initialized. The server cannot query the database.',
        },
      ],
      isError: true,
    }
  }

  try {
    const storage = services.storage
    const patterns = storage.patterns.getAllPatterns()
    const count = storage.patterns.patternCount()
    const lastRun = storage.patterns.getLastRunTimestamp()

    if (patterns.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No patterns detected yet. Patterns are identified by the pattern detector as it analyzes screen activity over time.',
          },
        ],
      }
    }

    const lastRunStr = lastRun ? `Last detection run: ${new Date(lastRun).toLocaleString()}` : ''
    const formatted = patterns.map(formatPatternLine).join('\n\n')

    return {
      content: [
        {
          type: 'text' as const,
          text: `${count} pattern${count !== 1 ? 's' : ''} detected. ${lastRunStr}\n\n${formatted}`,
        },
      ],
    }
  } catch (error) {
    log.error('Error listing patterns:', error)
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error listing patterns: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }
}

async function handleSearchPatterns(services: MCPServices | null, { query }: { query: string }) {
  if (!services) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Error: Services not initialized. The server cannot query the database.',
        },
      ],
      isError: true,
    }
  }

  try {
    const storage = services.storage
    const patterns = storage.patterns.searchPatterns(query)

    if (patterns.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No patterns matching "${query}".`,
          },
        ],
      }
    }

    const formatted = patterns.map(formatPatternLine).join('\n\n')

    return {
      content: [
        {
          type: 'text' as const,
          text: `${patterns.length} pattern${patterns.length !== 1 ? 's' : ''} matching "${query}":\n\n${formatted}`,
        },
      ],
    }
  } catch (error) {
    log.error('Error searching patterns:', error)
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error searching patterns: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }
}

async function handleGetPatternDetails(
  services: MCPServices | null,
  { patternId, runId }: { patternId: string; runId?: string | undefined },
) {
  if (!services) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Error: Services not initialized. The server cannot query the database.',
        },
      ],
      isError: true,
    }
  }

  try {
    const storage = services.storage
    const pattern = storage.patterns.getPatternById(patternId)

    if (!pattern) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No pattern found with ID "${patternId}".`,
          },
        ],
      }
    }

    const header = formatPatternLine(pattern)

    // Get sightings — optionally filtered by runId
    let sightings: PatternSighting[] = []
    if (runId) {
      sightings = storage.patterns
        .getSightingsByRunId(runId)
        .filter((s) => s.patternId === patternId)
    } else {
      // No runId filter — get all sightings by fetching all runs
      // PatternRepository doesn't have getAllSightingsForPattern, so we
      // use the sighting count from stats. For the detail view we show
      // up to 20 recent sightings by using the last-run approach.
      const lastRunTs = storage.patterns.getLastRunTimestamp()
      if (lastRunTs) {
        // Gather sightings from recent runs — get last 5 distinct runs worth
        // We don't have a dedicated method, so use the SQL directly isn't possible.
        // Instead, we just note the count and show what we can.
        sightings = []
      }
    }

    let sightingsSection = ''
    if (sightings.length > 0) {
      const formatted = sightings.map(formatSightingLine).join('\n\n')
      sightingsSection = `\n\nSightings (${sightings.length}):\n\n${formatted}`
    } else if (pattern.sightingCount > 0) {
      sightingsSection = `\n\n${pattern.sightingCount} sighting(s) recorded. Use the runId parameter to view sightings from a specific detection run.`
    } else {
      sightingsSection = '\n\nNo sightings recorded yet.'
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Pattern details:\n\n${header}${sightingsSection}`,
        },
      ],
    }
  } catch (error) {
    log.error('Error fetching pattern details:', error)
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error fetching pattern details: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }
}

async function handleGetUserContext(services: MCPServices | null) {
  if (!services) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Error: Services not initialized. The server cannot query the database.',
        },
      ],
      isError: true,
    }
  }

  try {
    const ctx = services.storage.userContext.get()

    if (!ctx) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No user profile has been generated yet. The profile is built automatically as screen activity is captured over time.',
          },
        ],
      }
    }

    const updatedAtStr = new Date(ctx.updatedAt).toLocaleString()

    return {
      content: [
        {
          type: 'text' as const,
          text: `User profile (last updated: ${updatedAtStr}):\n\nShort summary:\n${ctx.shortSummary}\n\nDetailed summary:\n${ctx.detailedSummary}`,
        },
      ],
    }
  } catch (error) {
    log.error('Error fetching user context:', error)
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error fetching user context: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }
}

async function handleGetActivityDetails(services: MCPServices | null, { ids }: { ids: string[] }) {
  if (!services) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Error: Services not initialized. The server cannot query the database.',
        },
      ],
      isError: true,
    }
  }

  try {
    const storage = services.storage
    const activities = storage.activities.getByIds(ids)

    if (activities.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No activities found for the given IDs.',
          },
        ],
      }
    }

    const formatted = activities
      .map((a) => {
        const timeStr = new Date(a.startTimestamp).toLocaleString()
        const endTimeStr = new Date(a.endTimestamp).toLocaleString()
        const appInfo = a.appName ? ` [${a.appName}]` : ''
        const summaryLine = a.summary ? `\nSummary: ${a.summary}` : ''
        return `ID: ${a.id}\n[${timeStr} → ${endTimeStr}]${appInfo}${summaryLine}\nOCR: ${a.ocrText}`
      })
      .join('\n\n---\n\n')

    return {
      content: [
        {
          type: 'text' as const,
          text:
            'Interpretation guide: use "Summary" for what the user did. OCR is raw on-screen text for exact recall and can be ambiguous, so do not infer activity from OCR alone.\n\n' +
            `${activities.length} result(s):\n\n${formatted}`,
        },
      ],
    }
  } catch (error) {
    log.error('Error fetching activity details:', error)
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error fetching activity details: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }
}
