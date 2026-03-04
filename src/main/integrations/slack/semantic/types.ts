import type { ActivitySummary } from '../../../storage'

export interface SlackSemanticMessage {
  channelId: string
  senderUserId: string
  messageTs: string
  text: string
}

export interface SlackSemanticContext {
  message: SlackSemanticMessage
  messageTimestampMs: number
  activities: ActivitySummary[]
}

export type RelevanceDecision =
  | { kind: 'not_relevant'; reason: string }
  | { kind: 'relevant'; reason: string }

export type DraftResult = { kind: 'no_reply'; reason: string } | { kind: 'reply'; text: string }

export type SlackReplyProposal =
  | { kind: 'reply'; source: 'legacy'; text: string }
  | { kind: 'reply'; source: 'semantic'; text: string; relevanceReason: string }
  | { kind: 'no_reply'; source: 'semantic'; stage: 'relevance' | 'draft'; reason: string }

export interface SlackChatResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

export interface SlackChatClient {
  chat: {
    send(request: {
      model: string
      messages: Array<{ role: 'system' | 'user'; content: string }>
    }): Promise<SlackChatResponse>
  }
}
