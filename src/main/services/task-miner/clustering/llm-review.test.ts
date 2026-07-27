import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { InferenceProvider } from '@main/llm'
import { generateText } from 'ai'
import { runLlmReview } from './llm-review'

vi.mock('ai', () => ({ generateText: vi.fn() }))

const mockedGenerateText = vi.mocked(generateText)

const languageModel: InferenceProvider['languageModel'] = () => 'model'
const provider = {
  isConfigured: () => true,
  languageModel,
} as InferenceProvider

describe('runLlmReview', () => {
  beforeEach(() => {
    mockedGenerateText.mockReset()
  })

  it('disables SDK retries — the mining ledger owns retry pacing', async () => {
    mockedGenerateText.mockResolvedValue({
      text: '{"clusters":[]}',
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never)

    const result = await runLlmReview(provider, 'model', { clusters: [], mergeCandidates: [] })

    expect(result.output).toEqual({ clusters: [] })
    expect(mockedGenerateText).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }))
  })
})
