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
  tool: vi.fn((def) => def),
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
    // One desktop, one web, so derived sighting apps cover both identities.
    for (const i of [1, 2]) {
      storage.activities.add({
        id: `act-${i}`,
        appName: i === 2 ? 'Google Chrome' : 'TestApp',
        windowTitle: 'w',
        tld: i === 2 ? 'www.notion.so' : null,
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

  it('scrubs secrets and phones from the scan prompt but keeps emails and names', async () => {
    storage.activities.add({
      id: 'act-pii',
      appName: 'TestApp',
      windowTitle: 'Call Jane Novak at +1 (555) 123-4567',
      tld: null,
      startTimestamp: dayStart(1) + 5000,
      endTimestamp: dayStart(1) + 5500,
      summary: 'Mailed jane.doe@acme.co the password: hunter42',
      summaryModel: '',
      ocrText: '',
      vector: v(0.1),
    })
    mockedGenerateText.mockResolvedValue(scanResponse('[]'))

    await runDetection(provider, storage, embedder, { lookbackDays: 1 })

    const call = mockedGenerateText.mock.calls[0][0] as { prompt: string }
    expect(call.prompt).not.toContain('555) 123-4567')
    expect(call.prompt).not.toContain('hunter42')
    expect(call.prompt).toContain('[phone number]')
    expect(call.prompt).toContain('[redacted password]')
    expect(call.prompt).toContain('Jane Novak')
    expect(call.prompt).toContain('jane.doe@acme.co')
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

  it('disables SDK retries on scan and grounding — the mining ledger owns retry pacing', async () => {
    mockedGenerateText
      .mockResolvedValueOnce(
        scanResponse(
          `\`\`\`json
[{"title":"Do the thing","subject":"thing","description":"d","activity_ids":["a1","a2"]}]
\`\`\``,
        ),
      )
      .mockResolvedValueOnce(
        scanResponse(`\`\`\`json
{"verdict":"keep","title":"Do the thing","description":"d"}
\`\`\``),
      )

    await runDetection(provider, storage, embedder, {
      lookbackDays: 1,
      scanOnly: false,
      onCommit: vi.fn(),
    })

    expect(mockedGenerateText).toHaveBeenCalledTimes(2)
    for (const [args] of mockedGenerateText.mock.calls) {
      expect(args).toMatchObject({ maxRetries: 0 })
    }
  })

  it('commits sightings and stats in one transaction', async () => {
    mockedGenerateText.mockResolvedValue(
      scanResponse(
        `\`\`\`json
[{"title":"Do the thing","subject":"thing","description":"d","activity_ids":["a1","a2"]}]
\`\`\``,
      ),
    )
    const onCommit = vi.fn()

    const result = await runDetection(provider, storage, embedder, { lookbackDays: 1, onCommit })

    expect(result.candidatesKept).toBe(1)
    expect(storage.sightings.hasInWindow(dayStart(1), dayStart(0) - 1)).toBe(true)
    expect(storage.sightings.getAll()[0].apps).toEqual(['TestApp', 'notion.so'])
    expect(storage.sightings.getAll()[0].steps).toEqual([])
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ candidatesKept: 1 }))
  })

  it('persists scan steps on the sighting (scan-only default)', async () => {
    mockedGenerateText.mockResolvedValue(
      scanResponse(
        `\`\`\`json
[{"title":"Do the thing","subject":"thing","description":"d","steps":["TestApp: open the export","notion.so: paste the rows"],"activity_ids":["a1","a2"]}]
\`\`\``,
      ),
    )

    await runDetection(provider, storage, embedder, { lookbackDays: 1 })

    expect(storage.sightings.getAll()[0].steps).toEqual([
      'TestApp: open the export',
      'notion.so: paste the rows',
    ])
  })

  it('grounding keep-verdict steps override the scan steps', async () => {
    mockedGenerateText
      .mockResolvedValueOnce(
        scanResponse(
          `\`\`\`json
[{"title":"Do the thing","subject":"thing","description":"d","steps":["TestApp: scan-guessed step"],"activity_ids":["a1","a2"]}]
\`\`\``,
        ),
      )
      .mockResolvedValueOnce(
        scanResponse(
          `\`\`\`json
{"verdict":"keep","title":"Do the thing","description":"d","steps":["notion.so: corrected step"]}
\`\`\``,
        ),
      )

    await runDetection(provider, storage, embedder, { lookbackDays: 1, scanOnly: false })

    expect(storage.sightings.getAll()[0].steps).toEqual(['notion.so: corrected step'])
  })

  it('keeps the scan steps when the keep-verdict omits them', async () => {
    mockedGenerateText
      .mockResolvedValueOnce(
        scanResponse(
          `\`\`\`json
[{"title":"Do the thing","subject":"thing","description":"d","steps":["TestApp: scan step"],"activity_ids":["a1","a2"]}]
\`\`\``,
        ),
      )
      .mockResolvedValueOnce(
        scanResponse(`\`\`\`json
{"verdict":"keep","title":"Do the thing","description":"d"}
\`\`\``),
      )

    await runDetection(provider, storage, embedder, { lookbackDays: 1, scanOnly: false })

    expect(storage.sightings.getAll()[0].steps).toEqual(['TestApp: scan step'])
  })

  it('persists no sightings when the commit callback throws (atomic day)', async () => {
    mockedGenerateText.mockResolvedValue(
      scanResponse(
        `\`\`\`json
[{"title":"Do the thing","subject":"thing","description":"d","activity_ids":["a1","a2"]}]
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
