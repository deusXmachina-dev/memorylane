// eslint-disable-next-line import/no-unresolved
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import * as fs from 'fs'
import { parseTimeString } from './parse-time'
import {
  formatTimelineEntry,
  sampleEntries,
  activityToTimelineEntry,
  TimelineEntry,
} from './formatting'
import { setDbPath, clearDbPath, type DbPathSource } from './config'
import { getDefaultDbPath } from '@main/utils/paths'
import type { AppEdition } from '../../shared/edition'
import type { StorageService, Sighting } from '../storage'
import type { EmbeddingService } from '../processor/embedding'
import {
  buildClusterInfo,
  computeClustersView,
  countObservedDays,
  filterClusters,
  isMissingClusterTables,
  statsWindowStart,
  MISSING_TABLES_TEXT,
} from '@main/ui/cluster-view'
import { CLUSTER_VIEW_CONFIG } from '@/shared/constants'
import type { ClusterInfo } from '../../shared/types'
import log from '@main/utils/logger'

export interface MCPServices {
  storage: StorageService
  embeddingService: EmbeddingService
}

export interface EditionContext {
  edition: AppEdition
  source: DbPathSource
  currentDbPath: string
}

/**
 * Registers all MCP tools on the given server.
 *
 * @param server - The MCP server instance to register tools on.
 * @param getServices - Lazy accessor for services (may be null before initialization).
 * @param reinitialize - Callback to switch the server's DB connection to a new path.
 *                       Used by the `set_db_path` / `reset_db_path` tools.
 * @param getEditionContext - Accessor for the active edition + where the
 *                            current DB path came from, so `get_db_path` can
 *                            report it.
 */
export function registerTools(
  server: McpServer,
  getServices: () => MCPServices | null,
  reinitialize: (dbPath: string, source?: DbPathSource) => Promise<void>,
  getEditionContext: () => EditionContext,
): void {
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
            'Filter: app or website, case-insensitive substring over app name and site host — "notion" matches the Notion app and notion.so, "stripe" matches dashboard.stripe.com',
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
            'Filter: app or website, case-insensitive substring over app name and site host — "notion" matches the Notion app and notion.so, "stripe" matches dashboard.stripe.com',
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
        'Retrieve the auto-generated user profile built from observed screen activity. Returns a short summary, a detailed summary, and when the profile was last updated. Useful for grounding personalized responses.',
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
        'List recurring task patterns mined from captured screen activity. ' +
        'Each pattern is a task the user performs repeatedly, with stats: times seen, ' +
        'estimated runs per week, average active minutes per run, apps involved, and last seen. ' +
        'Classified patterns also carry a kind (procedure, monitoring, ambient, dev-loop, judgment) ' +
        'and a "Replace with" automation recommendation. ' +
        'Ordered most frequent first; one-off noise is hidden. ' +
        'Use search_patterns for keyword filtering and get_pattern_details for individual runs.',
      inputSchema: {},
    },
    () => handleListPatterns(getServices()),
  )

  server.registerTool(
    'search_patterns',
    {
      description:
        'Search recurring task patterns by keyword. Case-insensitive match against the pattern ' +
        'title, description, apps, and automation recommendation. Returns the same stats as ' +
        'list_patterns. Use list_patterns to see all patterns without filtering.',
      inputSchema: {
        query: z
          .string()
          .describe(
            'Keyword to match against pattern title, description, apps, or automation recommendation',
          ),
      },
    },
    (params) => handleSearchPatterns(getServices(), params),
  )

  server.registerTool(
    'get_pattern_details',
    {
      description:
        'Fetch one recurring task pattern by ID, with its stats and the individual runs ' +
        'inside the stats window. ' +
        'Each run includes its time range, active minutes, apps, what was done, and the underlying ' +
        'activity IDs (pass those to get_activity_details for exact on-screen text). ' +
        'Use after list_patterns or search_patterns to drill into a specific pattern.',
      inputSchema: {
        patternId: z
          .string()
          .describe('Pattern ID (from list_patterns or search_patterns results)'),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Maximum runs to return, newest first (default: 20)'),
      },
    },
    (params) => handleGetPatternDetails(getServices(), params),
  )

  server.registerTool(
    'set_db_path',
    {
      title: 'Set Database Path',
      description:
        'Set the database path for the MCP server. Persists the path to config and reinitializes the connection. Does not affect the MemoryLane recorder, which always writes to the default DB. Use reset_db_path to revert to the default.',
      inputSchema: {
        dbPath: z.string().describe('Absolute path to the MemoryLane .db file'),
      },
    },
    async ({ dbPath: newDbPath }) => {
      if (!fs.existsSync(newDbPath)) {
        return {
          content: [
            { type: 'text' as const, text: `Error: database file not found at: ${newDbPath}` },
          ],
          isError: true,
        }
      }

      // Reinitialize first so we don't persist a path we can't actually open.
      // On failure, fall back to the default DB so the server stays usable and
      // the next startup doesn't re-read a poisoned cli.json.
      try {
        await reinitialize(newDbPath, 'config')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        try {
          await reinitialize(getDefaultDbPath(getEditionContext().edition), 'default')
        } catch {
          // ignore — surface the original failure
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: failed to open database at ${newDbPath}: ${message}`,
            },
          ],
          isError: true,
        }
      }

      setDbPath(newDbPath)

      return {
        content: [
          {
            type: 'text' as const,
            text: `Database path updated to: ${newDbPath}`,
          },
        ],
      }
    },
  )

  server.registerTool(
    'reset_db_path',
    {
      title: 'Reset Database Path',
      description:
        'Clear any custom DB path and revert the MCP server to the default database (the one the MemoryLane recorder writes to). Use after set_db_path when you are done inspecting a different DB.',
      inputSchema: {},
    },
    async () => {
      clearDbPath()
      const defaultPath = getDefaultDbPath(getEditionContext().edition)
      await reinitialize(defaultPath, 'default')
      return {
        content: [
          {
            type: 'text' as const,
            text: `Database path reset to default: ${defaultPath}`,
          },
        ],
      }
    },
  )

  server.registerTool(
    'get_db_path',
    {
      title: 'Get Database Path',
      description:
        'Return the database path the MCP server is currently using, where it came from (flag/env/config/default), the active edition, and the default path for that edition. Use to verify you are reading the right DB before querying, or to decide whether to call set_db_path / reset_db_path.',
      inputSchema: {},
    },
    async () => {
      const ctx = getEditionContext()
      const defaultForEdition = getDefaultDbPath(ctx.edition)
      const payload = {
        path: ctx.currentDbPath || defaultForEdition,
        source: ctx.source,
        edition: ctx.edition,
        defaultForEdition,
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
      }
    },
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

function patternToolError(action: string, error: unknown) {
  log.error(`Error ${action}:`, error)
  const text = isMissingClusterTables(error)
    ? MISSING_TABLES_TEXT
    : `Error ${action}: ${error instanceof Error ? error.message : String(error)}`
  return {
    content: [{ type: 'text' as const, text }],
    isError: true,
  }
}

function formatClusterLine(c: ClusterInfo): string {
  const stats = [`seen ${c.timesSeen}x`]
  if (c.observedDays > 0) {
    stats.push(`~${c.timesPerWeek.toFixed(1)}/wk over ${c.observedDays} observed days`)
  }
  stats.push(`avg ${Math.round(c.avgActiveMin)} min/run`)
  if (c.lastSeenAt) stats.push(`last seen ${new Date(c.lastSeenAt).toLocaleString()}`)
  const lines = [`- ${c.id} | ${c.title} [${c.apps.join(', ')}] (${stats.join(', ')})`]
  if (c.description) lines.push(`  ${c.description}`)
  if (c.mechanism) lines.push(`  Replace with: ${c.mechanism}`)
  return lines.join('\n')
}

function formatClusterSightingLine(s: Sighting): string {
  const start = new Date(s.startedAt).toLocaleString()
  const end = new Date(s.endedAt).toLocaleString()
  const activeMin = Math.round(Math.max(0, s.interactionMin))
  const title = s.subject ? `${s.title} — ${s.subject}` : s.title
  const lines = [
    `- ${s.id} | ${start} -> ${end} | ~${activeMin} min active | [${s.apps.join(', ')}]`,
  ]
  lines.push(`  ${title}`)
  if (s.description) lines.push(`  ${s.description}`)
  lines.push(`  Activity IDs: ${s.activityIds.join(', ')}`)
  return lines.join('\n')
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
    const { clusters, hiddenCount, observedDays } = computeClustersView(storage, Date.now())

    if (clusters.length === 0) {
      const text =
        hiddenCount > 0
          ? `No recurring task patterns yet, but mining is working: ${hiddenCount} task${hiddenCount !== 1 ? 's have' : ' has'} been seen only once (hidden as one-off noise). Patterns appear once a task recurs.`
          : 'No recurring task patterns found yet. Patterns are mined from captured screen activity over time (the task miner runs periodically inside the MemoryLane app).'
      return {
        content: [{ type: 'text' as const, text }],
      }
    }

    const lastMined = Math.max(0, ...storage.miningDays.getAll().map((d) => d.completedAt ?? 0))
    const lastMinedStr =
      lastMined > 0 ? ` Last mining run: ${new Date(lastMined).toLocaleString()}` : ''
    const hiddenStr = hiddenCount > 0 ? ` (${hiddenCount} hidden as one-off noise)` : ''
    const formatted = clusters.map(formatClusterLine).join('\n\n')

    return {
      content: [
        {
          type: 'text' as const,
          text: `${clusters.length} recurring task pattern${clusters.length !== 1 ? 's' : ''}${hiddenStr}. Stats cover the last ${CLUSTER_VIEW_CONFIG.STATS_WINDOW_DAYS} days (${observedDays} observed day${observedDays !== 1 ? 's' : ''}).${lastMinedStr}\n\n${formatted}`,
        },
      ],
    }
  } catch (error) {
    return patternToolError('listing patterns', error)
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
    const { clusters } = computeClustersView(services.storage, Date.now())
    const matches = filterClusters(clusters, query)

    if (matches.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No patterns matching "${query}".`,
          },
        ],
      }
    }

    const formatted = matches.map(formatClusterLine).join('\n\n')

    return {
      content: [
        {
          type: 'text' as const,
          text: `${matches.length} pattern${matches.length !== 1 ? 's' : ''} matching "${query}":\n\n${formatted}`,
        },
      ],
    }
  } catch (error) {
    return patternToolError('searching patterns', error)
  }
}

async function handleGetPatternDetails(
  services: MCPServices | null,
  { patternId, limit }: { patternId: string; limit?: number | undefined },
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
    const cluster = storage.clusters.getById(patternId)

    if (!cluster) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No pattern found with ID "${patternId}".`,
          },
        ],
      }
    }

    const now = Date.now()
    const allMembers = storage.clusters.getMembers(patternId) // started_at ASC
    const info = buildClusterInfo(cluster, allMembers, countObservedDays(storage, now), now)
    const header = formatClusterLine(info)

    // Same window as the header stats, so "seen Nx" matches the run count.
    const windowStart = statsWindowStart(now)
    const members = allMembers.filter((m) => m.startedAt >= windowStart)
    const windowStr = `last ${CLUSTER_VIEW_CONFIG.STATS_WINDOW_DAYS} days`

    let runsSection = ''
    if (members.length > 0) {
      const shown = members
        .slice()
        .reverse()
        .slice(0, limit ?? 20)
      const runsHeader =
        shown.length < members.length
          ? `Runs (showing ${shown.length} of ${members.length} in the ${windowStr}, newest first):`
          : `Runs (${members.length} in the ${windowStr}, newest first):`
      runsSection = `\n\n${runsHeader}\n\n${shown.map(formatClusterSightingLine).join('\n\n')}`
    } else if (allMembers.length > 0) {
      runsSection = `\n\nNo runs in the ${windowStr}.`
    } else {
      runsSection = '\n\nNo runs recorded yet.'
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Pattern details:\n\n${header}${runsSection}`,
        },
      ],
    }
  } catch (error) {
    return patternToolError('fetching pattern details', error)
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
