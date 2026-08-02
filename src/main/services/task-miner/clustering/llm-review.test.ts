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

describe('PII scrubbing', () => {
  const memberInput = {
    clusters: [
      {
        id: 'c1',
        splittable: false,
        label: '',
        stats: { times_seen: 2, span_days: 3, median_active_min: 5 },
        members: [
          {
            sighting_id: 's1',
            title: 'Email jane.doe@acme.co the report',
            subject: 'password: hunter42',
            description: 'Sent the weekly report',
            steps: ['mail.google.com: mail jane.doe@acme.co'],
            apps: ['mail.google.com'],
            active_min: 5,
            date: '2026-07-30',
          },
        ],
      },
    ],
    mergeCandidates: [] as [string, string][],
  }

  it('scrubs secrets from the prompt but keeps emails for context', async () => {
    mockedGenerateText.mockResolvedValue({
      text: '{"clusters":[]}',
      usage: { inputTokens: 1, outputTokens: 1 },
    } as never)

    await runContentReview(provider, 'model', memberInput)

    const call = mockedGenerateText.mock.calls[0][0] as { prompt: string }
    expect(call.prompt).not.toContain('hunter42')
    expect(call.prompt).toContain('[redacted password]')
    expect(call.prompt).toContain('jane.doe@acme.co')
  })

  it('scrubs model-written output through the injected scrubber before returning', async () => {
    mockedGenerateText.mockResolvedValue({
      text: JSON.stringify({
        clusters: [
          {
            id: 'c1',
            label: 'Email Jane Novak the report',
            description: 'Weekly report emailing',
            steps: ['mail.google.com: mail Jane Novak'],
            variables: ['recipient'],
          },
        ],
      }),
      usage: { inputTokens: 1, outputTokens: 1 },
    } as never)
    const scrub = vi.fn(async (texts: string[]) =>
      texts.map((t) => t.replace(/Jane Novak/g, '[redacted name]')),
    )

    const result = await runContentReview(provider, 'model', memberInput, undefined, scrub)

    expect(scrub).toHaveBeenCalledWith(expect.arrayContaining(['Email Jane Novak the report']), [
      'mail.google.com',
    ])
    expect(result.output?.clusters?.[0]).toEqual({
      id: 'c1',
      label: 'Email [redacted name] the report',
      description: 'Weekly report emailing',
      steps: ['mail.google.com: mail [redacted name]'],
      variables: ['recipient'],
    })
  })

  it('returns output untouched when no scrubber is provided', async () => {
    mockedGenerateText.mockResolvedValue({
      text: '{"clusters":[{"id":"c1","label":"Email Jane Novak"}]}',
      usage: { inputTokens: 1, outputTokens: 1 },
    } as never)

    const result = await runContentReview(provider, 'model', memberInput)

    expect(result.output?.clusters?.[0].label).toBe('Email Jane Novak')
  })
})
