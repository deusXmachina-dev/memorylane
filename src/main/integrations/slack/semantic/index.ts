import { OpenRouter } from '@openrouter/sdk'
import type { ActivityRepository } from '../../../storage'
import type { ApiKeyManager } from '../../../settings/api-key-manager'
import { SlackDraftService } from './draft-service'
import { SlackResearchService } from './research-service'
import type {
  SlackReplyProposal,
  SlackSemanticAnalysis,
  SlackSemanticInput,
  SlackSemanticMessage,
} from './types'

export interface SlackSemanticLayerDeps {
  activities: ActivityRepository
  apiKeyManager: ApiKeyManager
  embeddingService?: {
    generateEmbedding(text: string): Promise<number[]>
  }
}

export class SlackSemanticLayer {
  constructor(private readonly deps: SlackSemanticLayerDeps) {}

  public isConfigured(): boolean {
    return Boolean(this.deps.apiKeyManager.getApiKey())
  }

  public async proposeReply(message: SlackSemanticMessage): Promise<SlackReplyProposal> {
    const analysis = await this.analyzeMessage(message)
    return analysis.proposal
  }

  public async analyzeMessage(message: SlackSemanticMessage): Promise<SlackSemanticAnalysis> {
    const input = {
      message,
      messageTimestampMs: parseSlackTsToMs(message.messageTs),
    } satisfies SlackSemanticInput
    const client = this.getOpenRouterClient()

    if (!client) {
      return {
        input,
        clientConfigured: false,
        proposal: {
          kind: 'no_reply',
          source: 'semantic',
          stage: 'config',
          reason: 'Slack semantic replies currently require an OpenRouter key',
        },
      }
    }

    const researchOutcome = await new SlackResearchService(
      client,
      this.deps.activities,
      this.deps.embeddingService,
    ).decide(input)

    const relevance = researchOutcome.decision
    if (relevance.kind === 'not_relevant') {
      return {
        input,
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

    const draft = await new SlackDraftService(client).draft(input, {
      notes: relevance.notes,
      activityIds: relevance.activityIds,
    })
    if (draft.kind === 'no_reply') {
      return {
        input,
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
      input,
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
    const apiKey = this.deps.apiKeyManager.getApiKey()
    if (!apiKey) {
      return null
    }

    return new OpenRouter({ apiKey })
  }
}

function parseSlackTsToMs(ts: string): number {
  const parsed = Number.parseFloat(ts)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid Slack timestamp: ${ts}`)
  }
  return Math.round(parsed * 1000)
}
