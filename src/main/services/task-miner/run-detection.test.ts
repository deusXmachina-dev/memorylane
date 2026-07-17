import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { StorageService } from '@main/storage'
import { applyMigrations } from '@main/storage/migrator'
import { deleteDbFiles, v } from '@main/storage/test-utils'
import type { InferenceProvider } from '@main/llm'
import { generateText } from 'ai'
import { runDetection } from './run-detection'
import type { MinerEmbedder } from './types'

vi.mock('ai', () => ({
  generateText: vi.fn(),
  stepCountIs: vi.fn(),
}))

const mockedGenerateText = vi.mocked(generateText)

const languageModel: InferenceProvider['languageModel'] = () => 'model'
const provider = {
  isConfigured: () => true,
  languageModel,
} as InferenceProvider
const embedder: MinerEmbedder = {
  embed: async () => [0.1, 0.2, 0.3],
  embedBatch: async (texts) => texts.map(() => [0.1, 0.2, 0.3]),
}

const scanResponse = (text: string): never =>
  ({ text, usage: { inputTokens: 10, outputTokens: 5 } }) as never

describe('runDetection day commit', () => {
  const TEST_DB_PATH = path.join(os.tmpdir(), 'temp_run_detection_test.db')
  let storage: StorageService

  const dayStart = (daysBack: number): number => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack).getTime()
  }

  beforeEach(() => {
    deleteDbFiles(TEST_DB_PATH)
    storage = new StorageService(TEST_DB_PATH)
    applyMigrations(storage.getDatabase())
    mockedGenerateText.mockReset()
    // Two activities yesterday — enough for one MIN_RUN_ACTIVITIES candidate.
    for (const i of [1, 2]) {
      storage.activities.add({
        id: `act-${i}`,
        appName: 'TestApp',
        windowTitle: 'w',
        tld: null,
        startTimestamp: dayStart(1) + i * 1000,
        endTimestamp: dayStart(1) + i * 1000 + 500,
        summary: 's',
        summaryModel: '',
        ocrText: '',
        vector: v(0.1),
      })
    }
  })

  afterEach(() => {
    storage.close()
    deleteDbFiles(TEST_DB_PATH)
  })

  it('throws after all scan attempts return unusable output, leaving the day uncommitted', async () => {
    mockedGenerateText.mockResolvedValue(scanResponse('not json at all'))
    const onCommit = vi.fn()

    await expect(
      runDetection(provider, storage, embedder, { lookbackDays: 1, onCommit }),
    ).rejects.toThrow('no usable output')

    expect(mockedGenerateText).toHaveBeenCalledTimes(3)
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits a legitimately empty day ([] response) with zero sightings', async () => {
    mockedGenerateText.mockResolvedValue(scanResponse('```json\n[]\n```'))
    const onCommit = vi.fn()

    const result = await runDetection(provider, storage, embedder, { lookbackDays: 1, onCommit })

    expect(result.candidatesKept).toBe(0)
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ candidatesFromScan: 0, candidatesKept: 0 }),
    )
  })

  it('commits sightings and stats in one transaction', async () => {
    mockedGenerateText.mockResolvedValue(
      scanResponse(
        `\`\`\`json
[{"title":"Do the thing","subject":"thing","description":"d","apps":["TestApp"],"activity_ids":["a1","a2"]}]
\`\`\``,
      ),
    )
    const onCommit = vi.fn()

    const result = await runDetection(provider, storage, embedder, { lookbackDays: 1, onCommit })

    expect(result.candidatesKept).toBe(1)
    expect(storage.sightings.hasInWindow(dayStart(1), dayStart(0) - 1)).toBe(true)
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ candidatesKept: 1 }))
  })

  it('persists no sightings when the commit callback throws (atomic day)', async () => {
    mockedGenerateText.mockResolvedValue(
      scanResponse(
        `\`\`\`json
[{"title":"Do the thing","subject":"thing","description":"d","apps":["TestApp"],"activity_ids":["a1","a2"]}]
\`\`\``,
      ),
    )

    await expect(
      runDetection(provider, storage, embedder, {
        lookbackDays: 1,
        onCommit: () => {
          throw new Error('ledger write failed')
        },
      }),
    ).rejects.toThrow('ledger write failed')

    expect(storage.sightings.hasInWindow(dayStart(1), dayStart(0) - 1)).toBe(false)
  })
})
