import type { DraftResult, SlackChatClient, SlackSemanticContext } from './types'
import { buildDraftPrompt } from './prompt'

const DRAFT_MODEL = 'google/gemini-3-flash-preview'

export class SlackDraftService {
  constructor(private readonly client: SlackChatClient) {}

  public async draft(
    context: SlackSemanticContext,
    research?: { notes?: string; activityIds?: string[] },
  ): Promise<DraftResult> {
    const prompt = buildDraftPrompt(context, research)
    const response = await this.client.chat.send({
      model: DRAFT_MODEL,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    })

    return parseDraftResult(readText(response))
  }
}

function parseDraftResult(text: string): DraftResult {
  const parsed = parseJsonObject(text)
  const kind = typeof parsed.kind === 'string' ? parsed.kind : null

  if (kind === 'reply') {
    const replyText = typeof parsed.text === 'string' ? parsed.text.trim() : ''
    if (replyText.length === 0) {
      throw new Error(`Invalid draft response: ${text}`)
    }
    return {
      kind,
      text: replyText,
    }
  }

  if (kind === 'no_reply') {
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : ''
    return {
      kind,
      reason: reason || 'recent activity was still not enough to draft a useful reply',
    }
  }

  throw new Error(`Invalid draft response: ${text}`)
}

function readText(response: { choices?: Array<{ message?: { content?: string } }> }): string {
  const text = response.choices?.[0]?.message?.content
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Empty draft response')
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
