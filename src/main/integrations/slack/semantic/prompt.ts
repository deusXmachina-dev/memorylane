import { formatActivitiesForPrompt } from './context-builder'
import type { SlackSemanticContext } from './types'

export function buildRelevancePrompt(context: SlackSemanticContext): {
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
      `Slack message: ${JSON.stringify(context.message.text)}`,
      `Channel ID: ${context.message.channelId}`,
      `Sender user ID: ${context.message.senderUserId}`,
      `Message timestamp: ${new Date(context.messageTimestampMs).toISOString()}`,
      'Recent MemoryLane activities:',
      formatActivitiesForPrompt(context.activities),
    ].join('\n'),
  }
}

export function buildDraftPrompt(context: SlackSemanticContext): {
  system: string
  user: string
} {
  return {
    system: [
      'Write a short Slack reply using the message and recent computer activity.',
      'Do not mention MemoryLane, screenshots, OCR, or hidden context.',
      'Be direct and brief.',
      'Return JSON only.',
      'Valid outputs:',
      '{"kind":"reply","text":"reply text"}',
      '{"kind":"no_reply","reason":"short reason"}',
    ].join('\n'),
    user: [
      `Slack message: ${JSON.stringify(context.message.text)}`,
      'Recent MemoryLane activities:',
      formatActivitiesForPrompt(context.activities),
    ].join('\n'),
  }
}
