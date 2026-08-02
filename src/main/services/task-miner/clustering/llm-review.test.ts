import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { InferenceProvider } from '@main/llm'
import { generateText } from 'ai'
import { runStructureReview, runContentReview } from './llm-review'
import log from '@main/utils/logger'

vi.mock('ai', () => ({ generateText: vi.fn() }))
vi.mock('@main/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const mockedGenerateText = vi.mocked(generateText)
const mockedWarn = vi.mocked(log.warn)

const languageModel: InferenceProvider['languageModel'] = () => 'model'
const provider = {
  isConfigured: () => true,
  languageModel,
} as InferenceProvider

const emptyInput = { clusters: [], mergeCandidates: [] }

beforeEach(() => {
  mockedGenerateText.mockReset()
  mockedWarn.mockReset()
})

describe('runStructureReview', () => {
  it('disables SDK retries — the mining ledger owns retry pacing', async () => {
    mockedGenerateText.mockResolvedValue({
      text: '{"clusters":[],"merges":[]}',
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never)

    const result = await runStructureReview(provider, 'model', emptyInput)

    expect(result.output).toEqual({ clusters: [], merges: [] })
    expect(mockedGenerateText).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }))
  })

  it('retries a thrown call within the attempt budget', async () => {
    mockedGenerateText.mockRejectedValueOnce(new Error('timeout')).mockResolvedValue({
      text: '{"clusters":[],"merges":[]}',
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never)

    const result = await runStructureReview(provider, 'model', emptyInput)

    expect(result.output).toEqual({ clusters: [], merges: [] })
    expect(mockedGenerateText).toHaveBeenCalledTimes(2)
  })

  it('rethrows after the last attempt', async () => {
    mockedGenerateText.mockRejectedValue(new Error('timeout'))

    await expect(runStructureReview(provider, 'model', emptyInput)).rejects.toThrow('timeout')
    expect(mockedGenerateText).toHaveBeenCalledTimes(2)
  })
})

describe('id aliasing', () => {
  it('sends short handles and returns real ids', async () => {
    const clusterId = '11111111-1111-4111-8111-111111111111'
    mockedGenerateText.mockResolvedValue({
      text: '{"clusters":[{"id":"c1","label":"Process invoice"}],"merges":[]}',
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never)

    const result = await runStructureReview(provider, 'model', {
      clusters: [
        {
          id: clusterId,
          splittable: false,
          label: '',
          stats: { times_seen: 2, span_days: 3, median_active_min: 5 },
          members: [],
        },
      ],
      mergeCandidates: [],
    })

    const { prompt } = mockedGenerateText.mock.calls[0][0] as unknown as { prompt: string }
    expect(prompt).toContain('"c1"')
    expect(prompt).not.toContain(clusterId)
    expect(result.output?.clusters?.[0].id).toBe(clusterId)
  })

  it('keeps the verdicts and drops merges when a merge id does not resolve', async () => {
    const clusterId = '11111111-1111-4111-8111-111111111111'
    mockedGenerateText.mockResolvedValue({
      text: '{"clusters":[{"id":"c1","label":"Process invoice"}],"merges":[{"merge":["c1","c9"]}]}',
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never)

    const result = await runStructureReview(provider, 'model', {
      clusters: [
        {
          id: clusterId,
          splittable: false,
          label: '',
          stats: { times_seen: 2, span_days: 3, median_active_min: 5 },
          members: [],
        },
      ],
      mergeCandidates: [],
    })

    expect(mockedGenerateText).toHaveBeenCalledTimes(1)
    expect(result.output).toEqual({ clusters: [{ id: clusterId, label: 'Process invoice' }] })
    expect(mockedWarn).toHaveBeenCalledWith(expect.stringContaining('did not resolve'))
  })

  it('reports dropped handles without failing the response', async () => {
    mockedGenerateText.mockResolvedValue({
      text: '{"clusters":[{"id":"c9","label":"Invented"}],"merges":[]}',
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never)

    const result = await runStructureReview(provider, 'model', emptyInput)

    expect(mockedGenerateText).toHaveBeenCalledTimes(1)
    expect(result.output).toEqual({ clusters: [], merges: [] })
    expect(mockedWarn).toHaveBeenCalledWith(expect.stringContaining('1 id handle(s)'))
  })
})

describe('runContentReview', () => {
  it('retries an unparseable response and returns the parsed second attempt', async () => {
    mockedGenerateText
      .mockResolvedValueOnce({
        text: 'not json at all',
        usage: { inputTokens: 10, outputTokens: 5 },
      } as never)
      .mockResolvedValueOnce({
        text: '{"clusters":[]}',
        usage: { inputTokens: 10, outputTokens: 5 },
      } as never)

    const result = await runContentReview(provider, 'model', emptyInput)

    expect(result.output).toEqual({ clusters: [] })
    expect(result.tokenUsage).toEqual({ input: 20, output: 10 })
    expect(mockedGenerateText).toHaveBeenCalledTimes(2)
  })
})
