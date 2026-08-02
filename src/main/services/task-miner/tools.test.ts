import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import type { Tool, ToolExecutionOptions } from 'ai'
import { StorageService } from '@main/storage'
import { applyMigrations } from '@main/storage/migrator'
import { deleteDbFiles, v } from '@main/storage/test-utils'
import { PositionalAliases } from '@main/llm/id-codec'
import type { ActivityEmbeddingService } from '@main/activity/activity-transformer-types'
import { buildVerificationTools } from './tools'

const UUID_1 = '11111111-1111-4111-8111-111111111111'
const UUID_2 = '22222222-2222-4222-8222-222222222222'

const embeddingService: ActivityEmbeddingService = { embed: async () => v(0.1) }

interface Row {
  id: string
  app: string
  window_title: string
  time: string
  summary: string
}

/** The SDK types execute as optionally absent and possibly streaming; ours is neither. */
async function execute<IN, OUT extends Row>(target: Tool<IN, OUT[]>, params: IN): Promise<OUT[]> {
  if (!target.execute) throw new Error('tool has no execute')
  const result = await target.execute(params, {} as ToolExecutionOptions)
  if (!Array.isArray(result)) throw new Error('tool streamed instead of returning rows')
  return result
}

describe('buildVerificationTools id aliasing', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_miner_tools_test.db')
  let storage: StorageService
  let activityIds: PositionalAliases
  let dayStart: number
  let dayEnd: number

  const build = () =>
    buildVerificationTools(storage, embeddingService, dayStart, dayEnd, () => {}, activityIds)

  beforeEach(() => {
    deleteDbFiles(TEST_DB_PATH)
    storage = new StorageService(TEST_DB_PATH)
    applyMigrations(storage.getDatabase())
    activityIds = new PositionalAliases('a')

    const now = new Date()
    dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    dayEnd = dayStart + 24 * 60 * 60 * 1000
    for (const [i, id] of [UUID_1, UUID_2].entries()) {
      storage.activities.add({
        id,
        appName: 'TestApp',
        windowTitle: 'w',
        tld: null,
        startTimestamp: dayStart + (i + 1) * 60_000,
        endTimestamp: dayStart + (i + 1) * 60_000 + 500,
        summary: 's',
        summaryModel: '',
        ocrText: 'on screen',
        vector: v(0.1),
      })
    }
  })

  afterEach(() => {
    storage.close()
    deleteDbFiles(TEST_DB_PATH)
  })

  it('accepts handles and returns handles, never a uuid', async () => {
    expect(activityIds.encode(UUID_1)).toBe('a1')

    const result = await execute(build().get_activity_ocr, { activity_ids: ['a1'] })

    expect(result).toEqual([
      expect.objectContaining({ id: 'a1', ocr_text: 'on screen', app: 'TestApp' }),
    ])
  })

  it('drops an unreadable handle instead of querying it', async () => {
    activityIds.encode(UUID_1)

    const result = await execute(build().get_activity_ocr, { activity_ids: ['a1', 'a9'] })

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('a1')
  })

  it('mints handles for activities the browse tool surfaces first', async () => {
    const result = await execute(build().browse_timeline, {
      center_time: new Date(dayStart + 60_000).toISOString(),
      window_minutes: 120,
    })

    expect(result.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(activityIds.decode('a2')).toBe(UUID_2)
  })

  it('gives a browsed activity the same handle the scan already minted', async () => {
    activityIds.encode(UUID_2)

    const result = await execute(build().browse_timeline, {
      center_time: new Date(dayStart + 60_000).toISOString(),
      window_minutes: 120,
    })

    expect(result.map((a) => a.id)).toEqual(['a2', 'a1'])
  })

  it('returns handles from the search tool too', async () => {
    const result = await execute(build().search_similar_activities, { query: 'anything', limit: 5 })

    expect(result.length).toBeGreaterThan(0)
    for (const a of result) expect(a.id).toMatch(/^a\d+$/)
  })
})
