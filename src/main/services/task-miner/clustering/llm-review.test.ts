import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { InferenceProvider } from '@main/llm'
import { generateText } from 'ai'
import { runStructureReview, runContentReview } from './llm-review'

vi.mock('ai', () => ({ generateText: vi.fn() }))

const mockedGenerateText = vi.mocked(generateText)

const languageModel: InferenceProvider['languageModel'] = () => 'model'
const provider = {
  isConfigured: () => true,
  languageModel,
} as InferenceProvider

const emptyInput = { clusters: [], mergeCandidates: [] }

beforeEach(() => {
  mockedGenerateText.mockReset()
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
