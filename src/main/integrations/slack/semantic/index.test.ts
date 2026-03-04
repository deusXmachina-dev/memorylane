import { describe, expect, it, vi } from 'vitest'
import type { ActivityRepository, ActivitySummary } from '../../../storage'
import type { ApiKeyManager } from '../../../settings/api-key-manager'
import { SlackSemanticLayer } from './index'
import type { SlackChatClient } from './types'

function makeActivity(overrides?: Partial<ActivitySummary>): ActivitySummary {
  return {
    id: 'activity-1',
    startTimestamp: 1_710_000_000_000,
    endTimestamp: 1_710_000_060_000,
    appName: 'Code',
    windowTitle: 'src/main/index.ts',
    summary: 'Reviewed the Slack integration code path.',
    ...overrides,
  }
}

function makeRepo(activities: ActivitySummary[]): ActivityRepository {
  return {
    getByTimeRange: vi.fn().mockReturnValue(activities),
  } as unknown as ActivityRepository
}

function makeApiKeyManager(apiKey: string | null): ApiKeyManager {
  return {
    getApiKey: vi.fn().mockReturnValue(apiKey),
  } as unknown as ApiKeyManager
}

function response(content: string): { choices: Array<{ message: { content: string } }> } {
  return {
    choices: [{ message: { content } }],
  }
}

describe('SlackSemanticLayer', () => {
  it('falls back to the legacy reply when no model client is available', async () => {
    const layer = new SlackSemanticLayer({
      activities: makeRepo([makeActivity()]),
      apiKeyManager: makeApiKeyManager(null),
    })

    const result = await layer.proposeReply({
      channelId: 'C123',
      senderUserId: 'U123',
      messageTs: '1710000000.000100',
      text: 'Can you take a look at this?',
    })

    expect(result).toEqual({
      kind: 'reply',
      source: 'legacy',
      text: 'Thanks, I saw your message: Can you take a look at this?',
    })
  })

  it('skips replies when no recent activities match the Slack message timestamp', async () => {
    const client: SlackChatClient = {
      chat: {
        send: vi.fn(),
      },
    }

    const layer = new SlackSemanticLayer({
      activities: makeRepo([]),
      apiKeyManager: makeApiKeyManager('test-key'),
      client,
    })

    const result = await layer.proposeReply({
      channelId: 'C123',
      senderUserId: 'U123',
      messageTs: '1710000000.000100',
      text: 'Can you answer this thread?',
    })

    expect(result).toEqual({
      kind: 'no_reply',
      source: 'semantic',
      stage: 'relevance',
      reason: 'no recent MemoryLane activity matched the message timestamp',
    })
    expect(client.chat.send).not.toHaveBeenCalled()
  })

  it('uses the relevance model first and then drafts a reply', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        response('{"kind":"relevant","reason":"recent code review is relevant"}'),
      )
      .mockResolvedValueOnce(
        response('{"kind":"reply","text":"I was just reviewing that code path and can help."}'),
      )

    const layer = new SlackSemanticLayer({
      activities: makeRepo([makeActivity()]),
      apiKeyManager: makeApiKeyManager('test-key'),
      client: {
        chat: { send },
      },
    })

    const result = await layer.proposeReply({
      channelId: 'C123',
      senderUserId: 'U123',
      messageTs: '1710000000.000100',
      text: 'Do you know what changed here?',
    })

    expect(result).toEqual({
      kind: 'reply',
      source: 'semantic',
      text: 'I was just reviewing that code path and can help.',
      relevanceReason: 'recent code review is relevant',
    })

    expect(send).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: 'mistralai/mistral-small-3.2-24b-instruct' }),
    )
    expect(send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: 'google/gemini-3-flash-preview' }),
    )
  })

  it('skips replies when the relevance decision is negative', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        response('{"kind":"not_relevant","reason":"recent activity is unrelated"}'),
      )

    const layer = new SlackSemanticLayer({
      activities: makeRepo([makeActivity()]),
      apiKeyManager: makeApiKeyManager('test-key'),
      client: {
        chat: { send },
      },
    })

    const result = await layer.proposeReply({
      channelId: 'C123',
      senderUserId: 'U123',
      messageTs: '1710000000.000100',
      text: 'Lunch at 1?',
    })

    expect(result).toEqual({
      kind: 'no_reply',
      source: 'semantic',
      stage: 'relevance',
      reason: 'recent activity is unrelated',
    })
    expect(send).toHaveBeenCalledTimes(1)
  })
})
