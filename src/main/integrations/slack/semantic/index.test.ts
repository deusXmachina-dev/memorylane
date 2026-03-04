import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ActivityRepository, ActivitySummary } from '../../../storage'
import type { ApiKeyManager } from '../../../settings/api-key-manager'

const mocks = vi.hoisted(() => ({
  researchDecide: vi.fn(),
  draft: vi.fn(),
  openRouter: vi.fn(),
}))

vi.mock('@openrouter/sdk', () => ({
  OpenRouter: class {
    constructor(options: unknown) {
      mocks.openRouter(options)
    }
  },
}))

vi.mock('./research-service', () => ({
  SlackResearchService: class {
    public decide = mocks.researchDecide
  },
}))

vi.mock('./draft-service', () => ({
  SlackDraftService: class {
    public draft = mocks.draft
  },
}))

import { SlackSemanticLayer } from './index'

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

describe('SlackSemanticLayer', () => {
  beforeEach(() => {
    mocks.researchDecide.mockReset()
    mocks.draft.mockReset()
    mocks.openRouter.mockReset()
  })

  it('skips replies when no model client is available', async () => {
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
      kind: 'no_reply',
      source: 'semantic',
      stage: 'config',
      reason: 'Slack semantic replies currently require an OpenRouter key',
    })
    expect(mocks.researchDecide).not.toHaveBeenCalled()
    expect(mocks.draft).not.toHaveBeenCalled()
  })

  it('uses research first and skips when it finds no relevant evidence', async () => {
    mocks.researchDecide.mockResolvedValue({
      decision: {
        kind: 'not_relevant',
        reason: 'no useful memorylane evidence found',
      },
      trace: [],
    })

    const layer = new SlackSemanticLayer({
      activities: makeRepo([]),
      apiKeyManager: makeApiKeyManager('test-key'),
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
      reason: 'no useful memorylane evidence found',
    })
    expect(mocks.researchDecide).toHaveBeenCalledTimes(1)
    expect(mocks.draft).not.toHaveBeenCalled()
  })

  it('uses research findings and then drafts a reply', async () => {
    mocks.researchDecide.mockResolvedValue({
      decision: {
        kind: 'relevant',
        reason: 'found a relevant deployment record',
        notes: 'n8n is running on Google Cloud Run',
        activityIds: ['activity-1'],
      },
      trace: [],
    })
    mocks.draft.mockResolvedValue({
      kind: 'reply',
      text: 'We run n8n on Google Cloud Run.',
    })

    const layer = new SlackSemanticLayer({
      activities: makeRepo([makeActivity()]),
      apiKeyManager: makeApiKeyManager('test-key'),
    })

    const result = await layer.proposeReply({
      channelId: 'C123',
      senderUserId: 'U123',
      messageTs: '1710000000.000100',
      text: 'Do you know where n8n runs?',
    })

    expect(result).toEqual({
      kind: 'reply',
      source: 'semantic',
      text: 'We run n8n on Google Cloud Run.',
      relevanceReason: 'found a relevant deployment record',
    })
    expect(mocks.researchDecide).toHaveBeenCalledTimes(1)
    expect(mocks.draft).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ text: 'Do you know where n8n runs?' }),
      }),
      {
        notes: 'n8n is running on Google Cloud Run',
        activityIds: ['activity-1'],
      },
    )
  })

  it('returns a draft-stage no-reply when research is relevant but draft declines', async () => {
    mocks.researchDecide.mockResolvedValue({
      decision: {
        kind: 'relevant',
        reason: 'found relevant activity',
        notes: 'there was some evidence',
        activityIds: ['activity-1'],
      },
      trace: [],
    })
    mocks.draft.mockResolvedValue({
      kind: 'no_reply',
      reason: 'the researched findings were still not enough to draft a useful reply',
    })

    const layer = new SlackSemanticLayer({
      activities: makeRepo([makeActivity()]),
      apiKeyManager: makeApiKeyManager('test-key'),
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
      stage: 'draft',
      reason: 'the researched findings were still not enough to draft a useful reply',
    })
    expect(mocks.researchDecide).toHaveBeenCalledTimes(1)
    expect(mocks.draft).toHaveBeenCalledTimes(1)
  })
})
