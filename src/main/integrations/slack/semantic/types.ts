export interface SlackSemanticMessage {
  channelId: string
  senderUserId: string
  messageTs: string
  text: string
}

export interface SlackSemanticInput {
  message: SlackSemanticMessage
  messageTimestampMs: number
}

export type RelevanceDecision =
  | {
      kind: 'not_relevant'
      reason: string
      notes?: string
      activityIds?: string[]
    }
  | {
      kind: 'relevant'
      reason: string
      notes?: string
      activityIds?: string[]
    }

export type DraftResult = { kind: 'no_reply'; reason: string } | { kind: 'reply'; text: string }

export type SlackReplyProposal =
  | { kind: 'reply'; source: 'semantic'; text: string; relevanceReason: string }
  | {
      kind: 'no_reply'
      source: 'semantic'
      stage: 'config' | 'policy' | 'relevance' | 'draft'
      reason: string
    }

export interface SlackSemanticAnalysis {
  input: SlackSemanticInput
  clientConfigured: boolean
  relevanceDecision?: RelevanceDecision
  draftResult?: DraftResult
  researchTrace?: SlackResearchTrace[]
  proposal: SlackReplyProposal
}

export interface SlackResearchTrace {
  toolName: 'search_context' | 'browse_timeline' | 'get_activity_details'
  arguments: Record<string, unknown>
  resultSummary: string
}

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
