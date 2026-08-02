import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { InferenceProvider } from '@main/llm'
import { generateText } from 'ai'
import { runStructureReview, runContentReview } from './llm-review'
import type { ReviewCluster } from './types'

vi.mock('ai', () => ({ generateText: vi.fn() }))

const mockedGenerateText = vi.mocked(generateText)

const languageModel: InferenceProvider['languageModel'] = () => 'model'
const provider = {
  isConfigured: () => true,
  languageModel,
} as InferenceProvider

const emptyInput = { clusters: [], mergeCandidates: [] }

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'

function cluster(id: string): ReviewCluster {
  return {
    id,
    splittable: false,
    label: '',
    stats: { times_seen: 2, span_days: 3, median_active_min: 5 },
    members: [],
  }
}

function respond(text: string) {
  return { text, usage: { inputTokens: 10, outputTokens: 5 } } as never
}

function promptOf(call: number): string {
  return (mockedGenerateText.mock.calls[call][0] as unknown as { prompt: string }).prompt
}

beforeEach(() => {
  mockedGenerateText.mockReset()
})

describe('runStructureReview', () => {
  it('disables SDK retries — the mining ledger owns retry pacing', async () => {
    mockedGenerateText.mockResolvedValue(respond('{"clusters":[],"merges":[]}'))

    const result = await runStructureReview(provider, 'model', emptyInput)

    expect(result.output).toEqual({ clusters: [], merges: [] })
    expect(mockedGenerateText).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0 }))
  })

  it('retries a thrown call within the attempt budget', async () => {
    mockedGenerateText
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(respond('{"clusters":[],"merges":[]}'))

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
    mockedGenerateText.mockResolvedValue(
      respond('{"clusters":[{"id":"c1","label":"Process invoice"}],"merges":[]}'),
    )

    const result = await runStructureReview(provider, 'model', {
      clusters: [cluster(UUID_A)],
      mergeCandidates: [],
    })

    expect(promptOf(0)).toContain('"c1"')
    expect(promptOf(0)).not.toContain(UUID_A)
    expect(result.output?.clusters?.[0].id).toBe(UUID_A)
  })

  it('aliases the content call too', async () => {
    mockedGenerateText.mockResolvedValue(
      respond('{"clusters":[{"id":"c1","label":"Process invoice"}]}'),
    )

    const result = await runContentReview(provider, 'model', {
      clusters: [cluster(UUID_A)],
      mergeCandidates: [],
    })

    expect(promptOf(0)).not.toContain(UUID_A)
    expect(result.output?.clusters?.[0].id).toBe(UUID_A)
  })

  it('keeps handles stable across retries so a second attempt can still be read', async () => {
    mockedGenerateText
      .mockResolvedValueOnce(respond('not json at all'))
      .mockResolvedValueOnce(respond('{"clusters":[{"id":"c1","label":"Process invoice"}]}'))

    const result = await runStructureReview(provider, 'model', {
      clusters: [cluster(UUID_A)],
      mergeCandidates: [],
    })

    expect(promptOf(1)).toBe(promptOf(0))
    expect(result.output?.clusters?.[0].id).toBe(UUID_A)
  })

  it('keeps the readable merges and the verdicts when one merge id does not resolve', async () => {
    mockedGenerateText.mockResolvedValue(
      respond(
        '{"clusters":[{"id":"c1","label":"Process invoice"}],' +
          '"merges":[{"merge":["c1","c2"]},{"merge":["c1","c9"]}]}',
      ),
    )
    const progress = vi.fn()

    const result = await runStructureReview(
      provider,
      'model',
      { clusters: [cluster(UUID_A), cluster(UUID_B)], mergeCandidates: [[UUID_A, UUID_B]] },
      progress,
    )

    expect(mockedGenerateText).toHaveBeenCalledTimes(1)
    expect(result.output).toEqual({
      clusters: [{ id: UUID_A, label: 'Process invoice' }],
      merges: [{ merge: [UUID_A, UUID_B] }],
      mergesComplete: false,
    })
    expect(progress).toHaveBeenCalledWith(expect.stringContaining('could not be read'))
  })

  it('reports dropped handles through progress without failing the response', async () => {
    mockedGenerateText.mockResolvedValue(
      respond('{"clusters":[{"id":"c9","label":"Invented"}],"merges":[]}'),
    )
    const progress = vi.fn()

    const result = await runStructureReview(provider, 'model', emptyInput, progress)

    expect(mockedGenerateText).toHaveBeenCalledTimes(1)
    expect(result.output).toEqual({ clusters: [], merges: [] })
    expect(progress).toHaveBeenCalledWith(expect.stringContaining('1 id reference(s)'))
  })

  it('reports an unusable shape as a parse failure, not as unread ids', async () => {
    mockedGenerateText.mockResolvedValue(respond('{"clusters":{}}'))
    const progress = vi.fn()

    const result = await runStructureReview(provider, 'model', emptyInput, progress)

    expect(result.output).toBeNull()
    expect(mockedGenerateText).toHaveBeenCalledTimes(2)
    expect(progress).toHaveBeenCalledWith(expect.stringContaining('Could not use review response'))
    expect(progress).not.toHaveBeenCalledWith(expect.stringContaining('could not be read'))
  })
})

describe('runContentReview', () => {
  it('retries an unparseable response and returns the parsed second attempt', async () => {
    mockedGenerateText
      .mockResolvedValueOnce(respond('not json at all'))
      .mockResolvedValueOnce(respond('{"clusters":[]}'))

    const result = await runContentReview(provider, 'model', emptyInput)

    expect(result.output).toEqual({ clusters: [] })
    expect(result.tokenUsage).toEqual({ input: 20, output: 10 })
    expect(mockedGenerateText).toHaveBeenCalledTimes(2)
  })
})
