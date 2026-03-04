import type { SlackSemanticInput } from './types'

export function buildRelevancePrompt(input: SlackSemanticInput): {
  system: string
  user: string
} {
  return {
    system: [
      'Decide if recent computer activity is useful for answering a Slack message.',
      'Return JSON only.',
      'Valid outputs:',
      '{"kind":"relevant","reason":"short reason"}',
      '{"kind":"not_relevant","reason":"short reason"}',
      'Mark relevant only when the recent activity clearly helps answer the message.',
    ].join('\n'),
    user: [
      `Slack message: ${JSON.stringify(input.message.text)}`,
      `Channel ID: ${input.message.channelId}`,
      `Sender user ID: ${input.message.senderUserId}`,
      `Message timestamp: ${new Date(input.messageTimestampMs).toISOString()}`,
    ].join('\n'),
  }
}

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
