import { OpenRouter } from '@openrouter/sdk'
import type { ActivityRepository } from '../../../storage'
import type { ApiKeyManager } from '../../../settings/api-key-manager'
import { buildDraftReply, summarizeSourceText } from '../messages'
import { SlackContextBuilder } from './context-builder'
import { SlackDraftService } from './draft-service'
import { SlackRelevanceService } from './relevance-service'
import type { SlackChatClient, SlackReplyProposal, SlackSemanticMessage } from './types'

export interface SlackSemanticLayerDeps {
  activities: ActivityRepository
  apiKeyManager: ApiKeyManager
  client?: SlackChatClient
}

export class SlackSemanticLayer {
  private readonly contextBuilder: SlackContextBuilder
  private readonly injectedClient: SlackChatClient | null

  constructor(private readonly deps: SlackSemanticLayerDeps) {
    this.contextBuilder = new SlackContextBuilder(deps.activities)
    this.injectedClient = deps.client ?? null
  }

  public async proposeReply(message: SlackSemanticMessage): Promise<SlackReplyProposal> {
    const client = this.getClient()
    if (!client) {
      return {
        kind: 'reply',
        source: 'legacy',
        text: buildDraftReply(summarizeSourceText(message.text)),
      }
    }

    const context = this.contextBuilder.build(message)
    if (context.activities.length === 0) {
      return {
        kind: 'no_reply',
        source: 'semantic',
        stage: 'relevance',
        reason: 'no recent MemoryLane activity matched the message timestamp',
      }
    }

    const relevance = await new SlackRelevanceService(client).decide(context)
    if (relevance.kind === 'not_relevant') {
      return {
        kind: 'no_reply',
        source: 'semantic',
        stage: 'relevance',
        reason: relevance.reason,
      }
    }

    const draft = await new SlackDraftService(client).draft(context)
    if (draft.kind === 'no_reply') {
      return {
        kind: 'no_reply',
        source: 'semantic',
        stage: 'draft',
        reason: draft.reason,
      }
    }

    return {
      kind: 'reply',
      source: 'semantic',
      text: draft.text,
      relevanceReason: relevance.reason,
    }
  }

  private getClient(): SlackChatClient | null {
    if (this.injectedClient) {
      return this.injectedClient
    }

    const apiKey = this.deps.apiKeyManager.getApiKey()
    if (!apiKey) {
      return null
    }

    return new OpenRouter({ apiKey }) as unknown as SlackChatClient
  }
}
