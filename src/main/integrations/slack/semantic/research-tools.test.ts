import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StorageService } from '../../../storage'
import { createStoredActivity, deleteDbFiles, v } from '../../../storage/test-utils'
import { buildSlackResearchTools } from './research-tools'
import type { SlackResearchTrace } from './types'

describe('buildSlackResearchTools', () => {
  const TEST_DB_PATH = path.join(process.cwd(), 'temp_slack_research_tools.db')
  let storage: StorageService

  beforeEach(() => {
    deleteDbFiles(TEST_DB_PATH)
    storage = new StorageService(TEST_DB_PATH)
  })

  afterEach(() => {
    storage.close()
    deleteDbFiles(TEST_DB_PATH)
  })

  it('search_context returns relevant stored entries and records a trace', async () => {
    storage.activities.add(
      createStoredActivity({
        id: 'n8n-1',
        appName: 'Chrome',
        summary: 'Checked the n8n deployment in Railway and reviewed the environment settings.',
        windowTitle: 'n8n - Railway',
        vector: v(1, 0, 0),
      }),
    )
    storage.activities.add(
      createStoredActivity({
        id: 'unrelated-1',
        appName: 'Slack',
        summary: 'Chatted about lunch plans.',
        windowTitle: 'random',
        vector: v(0, 1, 0),
      }),
    )

    const traces: SlackResearchTrace[] = []
    const [searchTool] = buildSlackResearchTools({
      activities: storage.activities,
      embeddingService: {
        generateEmbedding: async () => v(1, 0, 0),
      },
      traces,
    })

    if (searchTool.function.execute === false) {
      throw new Error('search_context tool is not executable')
    }

    const result = await searchTool.function.execute({
      query: 'Where do we run n8n?',
      limit: 5,
    })

    expect(result.resultCount).toBeGreaterThan(0)
    expect(result.results[0]?.id).toBe('n8n-1')
    expect(result.text).toContain('n8n')
    expect(traces).toEqual([
      {
        toolName: 'search_context',
        arguments: { query: 'Where do we run n8n?', limit: 5 },
        resultSummary: 'returned 2 result(s)',
      },
    ])
  })
})
