/**
 * CLI command handlers — mirror the MCP tools using the same storage/embedding layer.
 *
 * Takes StorageService directly (and an optional embedding service for semantic search)
 * to avoid importing the ESM-only @huggingface/transformers at module load time.
 *
 * All command output goes through the `out` Writable (the real stdout), while errors
 * go to process.stderr. This keeps the output channel clean when stdout is redirected
 * to suppress logger/dotenv noise.
 */

import { Writable } from 'node:stream'
import { StorageService } from '../processor/storage'
import { parseTimeString } from '../mcp/parse-time'
import {
  formatTimelineEntry,
  sampleEntries,
  activityToTimelineEntry,
  TimelineEntry,
} from '../mcp/formatting'

interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>
}

// ---------------------------------------------------------------------------
// search — mirrors search_context
// ---------------------------------------------------------------------------

export async function handleSearch(
  storage: StorageService,
  embeddingService: EmbeddingProvider | null,
  out: Writable,
  opts: {
    query?: string
    start?: string
    end?: string
    app?: string
    limit?: number
    json: boolean
  },
): Promise<number> {
  const limit = opts.limit ?? 100

  const startTime = opts.start ? parseTimeString(opts.start) : undefined
  const endTime = opts.end ? parseTimeString(opts.end) : undefined

  if (opts.start && startTime === null) {
    process.stderr.write(`Error: Could not parse --start "${opts.start}".\n`)
    return 1
  }
  if (opts.end && endTime === null) {
    process.stderr.write(`Error: Could not parse --end "${opts.end}".\n`)
    return 1
  }

  // No query: chronological listing
  if (!opts.query) {
    if (startTime === undefined && endTime === undefined) {
      process.stderr.write('Error: Either a query or at least --start/--end is required.\n')
      return 1
    }

    const activities = await storage.getActivitiesByTimeRange(startTime ?? null, endTime ?? null, {
      appName: opts.app,
    })
    const entries = activities.map(activityToTimelineEntry)
    const sampled = sampleEntries(entries, limit, 'recent_first')

    if (sampled.length === 0) {
      out.write('No activities found in the given time range.\n')
      return 0
    }

    if (opts.json) {
      out.write(JSON.stringify(sampled, null, 2) + '\n')
      return 0
    }

    const header =
      sampled.length < entries.length
        ? `Showing ${sampled.length} of ${entries.length} activities:`
        : `${entries.length} activit${entries.length === 1 ? 'y' : 'ies'}:`
    out.write(`${header}\n\n`)
    out.write(sampled.map(formatTimelineEntry).join('\n') + '\n')
    return 0
  }

  // Semantic search (vector + FTS), or FTS-only if embeddings unavailable
  const filters = {
    startTime: startTime ?? undefined,
    endTime: endTime ?? undefined,
    appName: opts.app,
  }

  const allResults: TimelineEntry[] = []
  const seen = new Set<string>()

  if (embeddingService) {
    const [embedding, ftsResults] = await Promise.all([
      embeddingService.generateEmbedding(opts.query),
      storage.searchActivitiesFTS(opts.query, limit, filters).catch(() => []),
    ])
    const vectorResults = await storage.searchActivitiesVectors(embedding, limit, filters)

    // Deduplicate: vector results first (relevance order), then FTS extras
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
  } else {
    // FTS-only fallback
    const ftsResults = await storage.searchActivitiesFTS(opts.query, limit, filters)
    for (const a of ftsResults) {
      allResults.push(activityToTimelineEntry(a))
    }
  }

  const truncated = allResults.slice(0, limit)

  if (truncated.length === 0) {
    out.write('No relevant results found.\n')
    return 0
  }

  if (opts.json) {
    out.write(JSON.stringify(truncated, null, 2) + '\n')
    return 0
  }

  out.write(`Found ${truncated.length} relevant results:\n\n`)
  out.write(truncated.map(formatTimelineEntry).join('\n') + '\n')
  return 0
}

// ---------------------------------------------------------------------------
// timeline — mirrors browse_timeline
// ---------------------------------------------------------------------------

export async function handleTimeline(
  storage: StorageService,
  out: Writable,
  opts: {
    start?: string
    end?: string
    app?: string
    limit?: number
    sampling?: 'uniform' | 'recent_first'
    json: boolean
  },
): Promise<number> {
  if (!opts.start || !opts.end) {
    process.stderr.write('Error: --start and --end are required for timeline.\n')
    return 1
  }

  const startTime = parseTimeString(opts.start)
  const endTime = parseTimeString(opts.end)

  if (startTime === null) {
    process.stderr.write(`Error: Could not parse --start "${opts.start}".\n`)
    return 1
  }
  if (endTime === null) {
    process.stderr.write(`Error: Could not parse --end "${opts.end}".\n`)
    return 1
  }

  const activities = await storage.getActivitiesByTimeRange(startTime, endTime, {
    appName: opts.app,
  })
  const entries = activities.map(activityToTimelineEntry)

  if (entries.length === 0) {
    out.write('No activities found in the given time range.\n')
    return 0
  }

  const limit = opts.limit ?? 100
  const sampling = opts.sampling ?? 'uniform'
  const sampled = sampleEntries(entries, limit, sampling)

  if (opts.json) {
    out.write(JSON.stringify(sampled, null, 2) + '\n')
    return 0
  }

  const header =
    sampled.length < entries.length
      ? `Showing ${sampled.length} of ${entries.length} activities (${sampling} sampling):`
      : `${entries.length} activit${entries.length === 1 ? 'y' : 'ies'}:`

  out.write(`${header}\n\n`)
  out.write(sampled.map(formatTimelineEntry).join('\n') + '\n')
  return 0
}

// ---------------------------------------------------------------------------
// details — mirrors get_activity_details
// ---------------------------------------------------------------------------

export async function handleDetails(
  storage: StorageService,
  out: Writable,
  opts: {
    ids: string[]
    json: boolean
  },
): Promise<number> {
  const activities = await storage.getActivitiesByIds(opts.ids)

  if (activities.length === 0) {
    out.write('No activities found for the given IDs.\n')
    return 0
  }

  if (opts.json) {
    // Omit the vector field from JSON output — it's large and not useful for consumers
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const cleaned = activities.map(({ vector, ...rest }) => rest)
    out.write(JSON.stringify(cleaned, null, 2) + '\n')
    return 0
  }

  const formatted = activities
    .map((a) => {
      const timeStr = new Date(a.startTimestamp).toLocaleString()
      const endTimeStr = new Date(a.endTimestamp).toLocaleString()
      const appInfo = a.appName ? ` [${a.appName}]` : ''
      const durationSec = Math.round(a.durationMs / 1000)
      const summaryLine = a.summary ? `\nSummary: ${a.summary}` : ''
      const interactionLine = a.interactionSummary ? `\nInteractions: ${a.interactionSummary}` : ''
      return `ID: ${a.id}\n[${timeStr} → ${endTimeStr}]${appInfo} (${durationSec}s, ${a.screenshotCount} screenshots)${summaryLine}${interactionLine}\nOCR: ${a.ocrText}`
    })
    .join('\n\n---\n\n')

  out.write(`${activities.length} result(s):\n\n${formatted}\n`)
  return 0
}
