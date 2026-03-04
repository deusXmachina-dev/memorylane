import { tool } from '@openrouter/sdk'
import { z } from 'zod'
import type { ActivityRepository , StoredActivity } from '../../../storage'
import { parseTimeString } from '../../../mcp/parse-time'
import {
  activityToTimelineEntry,
  formatTimelineEntry,
  sampleEntries,
  type TimelineEntry,
} from '../../../mcp/formatting'
import type { SearchFilters } from '../../../../shared/types'
import log from '../../../logger'
import type { SlackResearchTrace } from './types'

export interface SlackResearchEmbeddingService {
  generateEmbedding(text: string): Promise<number[]>
}

export interface SlackResearchToolDeps {
  activities: ActivityRepository
  embeddingService: SlackResearchEmbeddingService
  traces: SlackResearchTrace[]
}

const SEARCH_RESULT_LIMIT = 8
const DETAILS_RESULT_LIMIT = 8

export function buildSlackResearchTools(deps: SlackResearchToolDeps) {
  return [
    tool({
      name: 'search_context',
      description:
        'Search activity by meaning and exact terms. Best for product names, services, repositories, files, channels, and specific questions.',
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().min(1).max(20).optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        appName: z.string().optional(),
      }),
      execute: async (params) => {
        const filters = parseFilters(params.startTime, params.endTime, params.appName)
        const effectiveLimit = params.limit ?? SEARCH_RESULT_LIMIT
        let ftsResults: ReturnType<ActivityRepository['searchFTS']> = []
        let vectorResults: ReturnType<ActivityRepository['searchVectors']> = []

        try {
          ftsResults = deps.activities.searchFTS(params.query, effectiveLimit, filters)
        } catch (error) {
          log.warn('[SlackSemantic] FTS search failed:', error)
        }

        try {
          const embedding = await deps.embeddingService.generateEmbedding(params.query)
          vectorResults = deps.activities.searchVectors(embedding, effectiveLimit, filters)
        } catch (error) {
          log.warn('[SlackSemantic] Vector search failed:', error)
        }

        const results = mergeTimelineResults(vectorResults, ftsResults).slice(0, effectiveLimit)
        const text = formatTimelineResultText(results)

        deps.traces.push({
          toolName: 'search_context',
          arguments: { ...params },
          resultSummary: `returned ${results.length} result(s)`,
        })

        return {
          resultCount: results.length,
          results,
          text,
        }
      },
    }),
    tool({
      name: 'browse_timeline',
      description:
        'Browse activity chronologically in a time window. Best for looking around when the relevant work probably happened.',
      inputSchema: z.object({
        startTime: z.string(),
        endTime: z.string(),
        appName: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        sampling: z.enum(['uniform', 'recent_first']).optional(),
      }),
      execute: (params) => {
        const startTime = parseRequiredTime(params.startTime)
        const endTime = parseRequiredTime(params.endTime)
        const entries = deps.activities
          .getByTimeRange(startTime, endTime, { appName: params.appName })
          .map(activityToTimelineEntry)
        const effectiveLimit = params.limit ?? 20
        const effectiveSampling = params.sampling ?? 'recent_first'
        const results = sampleEntries(entries, effectiveLimit, effectiveSampling)
        const text = formatTimelineResultText(results)

        deps.traces.push({
          toolName: 'browse_timeline',
          arguments: { ...params },
          resultSummary: `returned ${results.length} result(s) from ${entries.length} total`,
        })

        return {
          totalCount: entries.length,
          resultCount: results.length,
          results,
          text,
        }
      },
    }),
    tool({
      name: 'get_activity_details',
      description:
        'Fetch summary and OCR for specific activity IDs. Use only for promising IDs when exact text may answer the question.',
      inputSchema: z.object({
        ids: z.array(z.string()).min(1).max(DETAILS_RESULT_LIMIT),
      }),
      execute: (params) => {
        const activities = deps.activities.getByIds(params.ids).map(compactStoredActivity)
        deps.traces.push({
          toolName: 'get_activity_details',
          arguments: { ids: params.ids },
          resultSummary: `returned ${activities.length} detailed activit${activities.length === 1 ? 'y' : 'ies'}`,
        })

        return {
          resultCount: activities.length,
          activities,
        }
      },
    }),
  ] as const
}

function parseFilters(
  startTime: string | undefined,
  endTime: string | undefined,
  appName: string | undefined,
): SearchFilters {
  return {
    startTime: startTime ? parseRequiredTime(startTime) : undefined,
    endTime: endTime ? parseRequiredTime(endTime) : undefined,
    appName,
  }
}

function parseRequiredTime(value: string): number {
  const parsed = parseTimeString(value)
  if (parsed === null) {
    throw new Error(`Could not parse time value "${value}"`)
  }
  return parsed
}

function mergeTimelineResults(
  vectorResults: ReturnType<ActivityRepository['searchVectors']>,
  ftsResults: ReturnType<ActivityRepository['searchFTS']>,
): TimelineEntry[] {
  const seen = new Set<string>()
  const merged: TimelineEntry[] = []

  for (const activity of vectorResults) {
    seen.add(activity.id)
    merged.push(activityToTimelineEntry(activity))
  }

  for (const activity of ftsResults) {
    if (seen.has(activity.id)) {
      continue
    }
    seen.add(activity.id)
    merged.push(activityToTimelineEntry(activity))
  }

  return merged
}

function compactStoredActivity(activity: StoredActivity) {
  return {
    id: activity.id,
    startTimestamp: activity.startTimestamp,
    endTimestamp: activity.endTimestamp,
    appName: activity.appName,
    windowTitle: activity.windowTitle,
    summary: activity.summary,
    ocrText: activity.ocrText,
  }
}

function formatTimelineResultText(entries: TimelineEntry[]): string {
  if (entries.length === 0) {
    return 'No matching activities found.'
  }
  return entries.map(formatTimelineEntry).join('\n')
}
