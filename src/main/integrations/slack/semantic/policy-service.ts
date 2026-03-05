import type { SlackChatClient, SlackSemanticInput } from './types'

const POLICY_MODEL = 'google/gemini-3-flash-preview'

export type PolicyDecision =
  | {
      kind: 'allow'
    }
  | {
      kind: 'deny'
      category: string
      reason: string
    }

export class SlackPolicyService {
  constructor(private readonly client: SlackChatClient) {}

  public async classify(input: SlackSemanticInput): Promise<PolicyDecision> {
    const response = await this.client.chat.send({
      model: POLICY_MODEL,
      messages: [
        {
          role: 'system',
          content: [
            'Classify if a Slack message is in scope for MemoryLane-assisted replies.',
            'Block messages that ask for personal details, money/wages, health details, PII, passwords, secrets, credentials, or tokens.',
            'Return JSON only.',
            'Valid outputs:',
            '{"kind":"allow"}',
            '{"kind":"deny","category":"short category","reason":"short reason"}',
          ].join('\n'),
        },
        { role: 'user', content: buildPolicyInput(input) },
      ],
    })

    return parsePolicyDecision(readText(response))
  }
}

function buildPolicyInput(input: SlackSemanticInput): string {
  return [
    `Slack message: ${JSON.stringify(input.message.text)}`,
    `Channel ID: ${input.message.channelId}`,
    `Sender user ID: ${input.message.senderUserId}`,
  ].join('\n')
}

function parsePolicyDecision(text: string): PolicyDecision {
  const parsed = parseJsonObject(text)
  const kind = typeof parsed.kind === 'string' ? parsed.kind : null
  if (kind === 'allow') {
    return { kind }
  }

  if (kind === 'deny') {
    const category = typeof parsed.category === 'string' ? parsed.category.trim() : ''
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : ''
    return {
      kind,
      category: category || 'sensitive topic',
      reason: reason || 'sensitive topic is out of scope',
    }
  }

  throw new Error(`Invalid policy response: ${text}`)
}

function readText(response: { choices?: Array<{ message?: { content?: string } }> }): string {
  const text = response.choices?.[0]?.message?.content
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Empty policy response')
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
