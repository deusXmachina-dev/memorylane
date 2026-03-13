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
  ] as const
}
