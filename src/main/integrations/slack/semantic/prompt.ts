import type { SlackSemanticInput } from './types'

export function buildDraftPrompt(input: SlackSemanticInput): {
  system: string
  user: string
}

export function buildDraftPrompt(
  input: SlackSemanticInput,
  research?: { notes?: string; activityIds?: string[] },
): {
  system: string
  user: string
} {
  return {
    system: [
      'Write a short Slack reply using the message and the researched MemoryLane findings.',
      'Do not mention MemoryLane, screenshots, OCR, or hidden context.',
      'Do not answer personal matters or anything related to money, wages, health, PII, passwords, or secrets.',
      'If the request touches those topics, return {"kind":"no_reply","reason":"sensitive topic is out of scope"}.',
      'Be direct and brief.',
      'Return JSON only.',
      'Valid outputs:',
      '{"kind":"reply","text":"reply text"}',
      '{"kind":"no_reply","reason":"short reason"}',
    ].join('\n'),
    user: [
      `Slack message: ${JSON.stringify(input.message.text)}`,
      research?.notes ? `Relevant MemoryLane findings: ${research.notes}` : null,
      research?.activityIds?.length
        ? `Relevant activity IDs: ${research.activityIds.join(', ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n'),
  }
}
