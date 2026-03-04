import { OpenRouter } from '@openrouter/sdk'
import type { ActivityRepository } from '../../../storage'
import type { ApiKeyManager } from '../../../settings/api-key-manager'
import { buildDraftReply, summarizeSourceText } from '../messages'
import { SlackContextBuilder } from './context-builder'
import { SlackDraftService } from './draft-service'
import { SlackResearchService } from './research-service'
import { SlackRelevanceService } from './relevance-service'
import type {
  SlackChatClient,
  SlackReplyProposal,
  SlackResearchTrace,
  SlackSemanticAnalysis,
  SlackSemanticMessage,
} from './types'

export interface SlackSemanticLayerDeps {
  activities: ActivityRepository
  apiKeyManager: ApiKeyManager
  client?: SlackChatClient
  embeddingService?: {
    generateEmbedding(text: string): Promise<number[]>
  }
}

export class SlackSemanticLayer {
  private readonly contextBuilder: SlackContextBuilder
  private readonly injectedClient: SlackChatClient | null

  constructor(private readonly deps: SlackSemanticLayerDeps) {
    this.contextBuilder = new SlackContextBuilder(deps.activities)
    this.injectedClient = deps.client ?? null
  }

  public async proposeReply(message: SlackSemanticMessage): Promise<SlackReplyProposal> {
    const analysis = await this.analyzeMessage(message)
    return analysis.proposal
  }

  public async analyzeMessage(message: SlackSemanticMessage): Promise<SlackSemanticAnalysis> {
    const context = this.contextBuilder.build(message)
    const openRouterClient = this.getOpenRouterClient()
    const client = this.getChatClient(openRouterClient)

    if (!client) {
      return {
        context,
        clientConfigured: false,
        proposal: {
          kind: 'reply',
          source: 'legacy',
          text: buildDraftReply(summarizeSourceText(message.text)),
        },
      }
    }

    if (this.injectedClient && context.activities.length === 0) {
      return {
        context,
        clientConfigured: true,
        proposal: {
          kind: 'no_reply',
          source: 'semantic',
          stage: 'relevance',
          reason: 'no recent MemoryLane activity matched the message timestamp',
        },
      }
    }

    const researchOutcome =
      this.injectedClient === null && openRouterClient
        ? await new SlackResearchService(
            openRouterClient,
            this.deps.activities,
            this.deps.embeddingService,
          ).decide(context)
        : {
            decision: await new SlackRelevanceService(client).decide(context),
            trace: [] as SlackResearchTrace[],
          }

    const relevance = researchOutcome.decision
    if (relevance.kind === 'not_relevant') {
      return {
        context,
        clientConfigured: true,
        relevanceDecision: relevance,
        researchTrace: researchOutcome.trace,
        proposal: {
          kind: 'no_reply',
          source: 'semantic',
          stage: 'relevance',
          reason: relevance.reason,
        },
      }
    }

    const draft = await new SlackDraftService(client).draft(context, {
      notes: relevance.notes,
      activityIds: relevance.activityIds,
    })
    if (draft.kind === 'no_reply') {
      return {
        context,
        clientConfigured: true,
        relevanceDecision: relevance,
        draftResult: draft,
        researchTrace: researchOutcome.trace,
        proposal: {
          kind: 'no_reply',
          source: 'semantic',
          stage: 'draft',
          reason: draft.reason,
        },
      }
    }

    return {
      context,
      clientConfigured: true,
      relevanceDecision: relevance,
      draftResult: draft,
      researchTrace: researchOutcome.trace,
      proposal: {
        kind: 'reply',
        source: 'semantic',
        text: draft.text,
        relevanceReason: relevance.reason,
      },
    }
  }

  private getOpenRouterClient(): OpenRouter | null {
    if (this.injectedClient) {
      return null
    }

    const apiKey = this.deps.apiKeyManager.getApiKey()
    if (!apiKey) {
      return null
    }

    return new OpenRouter({ apiKey })
  }

  private getChatClient(openRouterClient: OpenRouter | null): SlackChatClient | null {
    if (this.injectedClient) {
      return this.injectedClient
    }

    return openRouterClient as unknown as SlackChatClient
  }
}
