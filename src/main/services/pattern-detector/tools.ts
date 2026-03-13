import { tool } from '@openrouter/sdk'
import { z } from 'zod'
import type { StorageService } from '../../storage'
import type { EmbeddingService } from '../../processor/embedding'

export function buildVerificationTools(
  storage: StorageService,
  embeddingService: EmbeddingService,
  dayStart: number,
  dayEnd: number,
  progress: (msg: string) => void,
) {
  return [
    tool({
      name: 'get_activity_ocr',
      description:
        'Fetch OCR text (what was on screen) for specific activities by ID. Use to see the actual content the user was looking at.',
      inputSchema: z.object({
        activity_ids: z
          .array(z.string())
          .min(1)
          .max(5)
          .describe(
            'Activity IDs to fetch OCR for (max 5 per call, call multiple times if needed)',
          ),
      }),
      execute: (params) => {
        progress(`  [tool] get_activity_ocr: ${params.activity_ids.length} IDs`)
        const activities = storage.activities.getByIds(params.activity_ids)
        return activities.map((a) => ({
          id: a.id,
          app: a.appName,
          window_title: a.windowTitle,
          time: new Date(a.startTimestamp).toISOString(),
          summary: a.summary,
          ocr_text: a.ocrText || '(no OCR text captured)',
        }))
      },
    }),
    tool({
      name: 'search_similar_activities',
      description:
        'Semantic search for activities similar to a query within the current detection day. Use to find related activities the candidate may have missed.',
      inputSchema: z.object({
        query: z.string().describe('Natural language description of what to search for'),
        limit: z.number().int().min(1).max(20).optional().describe('Max results (default 10)'),
      }),
      execute: async (params) => {
        progress(`  [tool] search_similar_activities: "${params.query}"`)
        const embedding = await embeddingService.generateEmbedding(params.query)
        const allResults = storage.activities.searchVectors(embedding, (params.limit ?? 10) * 3)
        // Filter to detection day time range
        const results = allResults
          .filter((a) => a.startTimestamp >= dayStart && a.startTimestamp < dayEnd)
          .slice(0, params.limit ?? 10)
        return results.map((a) => ({
          id: a.id,
          app: a.appName,
          window_title: a.windowTitle,
          time: new Date(a.startTimestamp).toISOString(),
          duration_min: Math.round((a.endTimestamp - a.startTimestamp) / 60000),
          summary: a.summary,
        }))
      },
    }),
    tool({
      name: 'browse_timeline',
      description:
        'Browse the activity timeline around a specific time to see surrounding context. Returns activities within a time window, ordered chronologically.',
      inputSchema: z.object({
        center_time: z
          .string()
          .describe(
            "ISO 8601 timestamp to center the window on (e.g. from an activity's time field)",
          ),
        window_minutes: z
          .number()
          .int()
          .min(5)
          .max(120)
          .optional()
          .describe('How many minutes before and after center_time to include (default 30)'),
      }),
      execute: (params) => {
        const centerMs = new Date(params.center_time).getTime()
        const windowMs = (params.window_minutes ?? 30) * 60000
        const rangeStart = Math.max(dayStart, centerMs - windowMs)
        const rangeEnd = Math.min(dayEnd, centerMs + windowMs)
        progress(
          `  [tool] browse_timeline: ±${params.window_minutes ?? 30}min around ${params.center_time}`,
        )
        const activities = storage.activities.getForDay(rangeStart, rangeEnd)
        return activities.map((a) => ({
          id: a.id,
          app: a.appName,
          window_title: a.windowTitle,
          time: new Date(a.startTimestamp).toISOString(),
          end_time: new Date(a.endTimestamp).toISOString(),
          duration_min: Math.round((a.endTimestamp - a.startTimestamp) / 60000),
          summary: a.summary,
        }))
      },
    }),
  ] as const
}
