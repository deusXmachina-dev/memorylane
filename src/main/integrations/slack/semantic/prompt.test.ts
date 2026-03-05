import { describe, expect, it } from 'vitest'
import { buildDraftPrompt } from './prompt'

describe('buildDraftPrompt', () => {
  it('includes sensitive-topic guardrails', () => {
    const prompt = buildDraftPrompt({
      message: {
        channelId: 'C123',
        senderUserId: 'U123',
        messageTs: '1710000000.000100',
        text: 'Can you help?',
      },
      messageTimestampMs: 1_710_000_000_100,
    })

    expect(prompt.system).toContain(
      'Do not answer personal matters or anything related to money, wages, health, PII, passwords, or secrets.',
    )
    expect(prompt.system).toContain('If the request touches those topics, return')
  })
})
