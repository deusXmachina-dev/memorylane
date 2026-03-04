import type { SlackChatClient, RelevanceDecision, SlackSemanticContext } from './types'
import { buildRelevancePrompt } from './prompt'

const RELEVANCE_MODEL = 'mistralai/mistral-small-3.2-24b-instruct'

export class SlackRelevanceService {
  constructor(private readonly client: SlackChatClient) {}

  public async decide(context: SlackSemanticContext): Promise<RelevanceDecision> {
    const prompt = buildRelevancePrompt(context)
    const response = await this.client.chat.send({
      model: RELEVANCE_MODEL,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    })

    return parseRelevanceDecision(readText(response))
  }
}

function parseRelevanceDecision(text: string): RelevanceDecision {
  const parsed = parseJsonObject(text)
  const kind = typeof parsed.kind === 'string' ? parsed.kind : null
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : ''

  if (kind === 'relevant') {
    return {
      kind,
      reason: reason || 'recent activity helps answer the message',
    }
  }

  if (kind === 'not_relevant') {
    return {
      kind,
      reason: reason || 'recent activity does not help answer the message',
    }
  }

  throw new Error(`Invalid relevance response: ${text}`)
}

function readText(response: { choices?: Array<{ message?: { content?: string } }> }): string {
  const text = response.choices?.[0]?.message?.content
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Empty relevance response')
  }
  return text.trim()
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
