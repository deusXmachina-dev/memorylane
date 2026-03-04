import type { PendingApproval, SlackMessage, SlackReaction } from './types'

export function isPlainUserMessage(
  message: SlackMessage | undefined,
  expectedUserId?: string,
): message is SlackMessage {
  if (!message) return false
  if (message.subtype !== undefined) return false
  if (typeof message.user !== 'string' || message.user.length === 0) return false
  if (expectedUserId && message.user !== expectedUserId) return false
  if (typeof message.bot_id === 'string' && message.bot_id.length > 0) return false
  return typeof message.text === 'string' && message.text.trim().length > 0
}

export function summarizeSourceText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= 220 ? normalized : `${normalized.slice(0, 217)}...`
}

export function buildDraftReply(sourceText: string): string {
  return `Thanks, I saw your message: ${sourceText}`
}

export function formatApprovalText(pending: PendingApproval): string {
  return [
    '*Approve reply?*',
    `Channel: <#${pending.sourceChannelId}>`,
    `From: <@${pending.sourceUserId}>`,
    `Original: ${pending.sourceText}`,
    '',
    '*Draft reply*',
    pending.replyText,
    '',
    'React with :+1: to approve or :-1: to reject.',
  ].join('\n')
}

export function compareTs(left: string, right: string): number {
  return Number.parseFloat(left) - Number.parseFloat(right)
}

export function getNewestTs(messages: SlackMessage[], fallback: string): string {
  return messages.reduce(
    (latest, message) => (compareTs(message.ts, latest) > 0 ? message.ts : latest),
    fallback,
  )
}

export function hasReactionFromUser(
  reactions: SlackReaction[] | undefined,
  reactionNames: readonly string[],
  userId: string,
): boolean {
  if (!reactions) return false

  return reactions.some(
    (reaction) =>
      reactionNames.includes(reaction.name) &&
      Array.isArray(reaction.users) &&
      reaction.users.includes(userId),
  )
}
