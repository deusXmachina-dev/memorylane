import { OpenRouter, stepCountIs } from '@openrouter/sdk'
import { callModel } from '@openrouter/sdk/funcs/call-model'
import { EmbeddingService } from '../../../processor/embedding'
import { formatActivitiesForPrompt } from './context-builder'
import { buildSlackResearchTools, type SlackResearchEmbeddingService } from './research-tools'
import type { ActivityRepository } from '../../../storage'
import type { RelevanceDecision, SlackResearchTrace, SlackSemanticContext } from './types'

const RESEARCH_MODEL = 'google/gemini-3-flash-preview'

export class SlackResearchService {
  private readonly embeddingService: SlackResearchEmbeddingService

  constructor(
    private readonly client: OpenRouter,
    private readonly activities: ActivityRepository,
    embeddingService?: SlackResearchEmbeddingService,
  ) {
    this.embeddingService = embeddingService ?? new EmbeddingService()
  }

  public async decide(context: SlackSemanticContext): Promise<{
    decision: RelevanceDecision
    trace: SlackResearchTrace[]
  }> {
    const trace: SlackResearchTrace[] = []
    const tools = buildSlackResearchTools({
      activities: this.activities,
      embeddingService: this.embeddingService,
      traces: trace,
    })

    const result = callModel(this.client, {
      model: RESEARCH_MODEL,
      instructions: [
        'You are checking whether MemoryLane activity can help answer a Slack message.',
        'You may use tools to search activity before deciding.',
        'Search for likely entities and synonyms from the message: product names, services, apps, repos, file names, channels, hosts, environments, and exact phrases.',
        'Prefer search_context first.',
        'Use browse_timeline around the message timestamp when the answer may be time-based or recent.',
        'Use get_activity_details only for promising IDs when exact strings may matter.',
        'Return JSON only.',
        'Valid output:',
        '{"kind":"relevant","reason":"short reason","notes":"short evidence summary","activityIds":["id1","id2"]}',
        '{"kind":"not_relevant","reason":"short reason","notes":"short evidence summary","activityIds":[]}',
        'Mark relevant only when the found activity actually helps answer the Slack message.',
      ].join('\n'),
      input: buildResearchInput(context),
      tools,
      stopWhen: stepCountIs(6),
    })

    const text = await result.getText()
    return {
      decision: parseResearchDecision(text),
      trace,
    }
  }
}

function buildResearchInput(context: SlackSemanticContext): string {
  const messageTimeIso = new Date(context.messageTimestampMs).toISOString()
  return [
    `Slack message: ${JSON.stringify(context.message.text)}`,
    `Channel ID: ${context.message.channelId}`,
    `Sender user ID: ${context.message.senderUserId}`,
    `Message timestamp: ${messageTimeIso}`,
    'Recent nearby activity for orientation:',
    formatActivitiesForPrompt(context.activities),
    '',
    'Goal: find whether MemoryLane has evidence that would help answer the Slack message.',
  ].join('\n')
}

function parseResearchDecision(text: string): RelevanceDecision {
  const parsed = parseJsonObject(text)
  const kind = typeof parsed.kind === 'string' ? parsed.kind : null
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : ''
  const notes = typeof parsed.notes === 'string' ? parsed.notes.trim() : ''
  const activityIds = Array.isArray(parsed.activityIds)
    ? parsed.activityIds.filter((value): value is string => typeof value === 'string')
    : []

  if (kind === 'relevant') {
    return {
      kind,
      reason: reason || 'found relevant MemoryLane activity',
      notes: notes || undefined,
      activityIds,
    }
  }

  if (kind === 'not_relevant') {
    return {
      kind,
      reason: reason || 'did not find useful MemoryLane activity',
      notes: notes || undefined,
      activityIds,
    }
  }

  throw new Error(`Invalid research response: ${text}`)
}

function parseJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const raw = fenced ? fenced[1] : text
  const parsed = JSON.parse(raw)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Response is not a JSON object')
  }
  return parsed as Record<string, unknown>
}
