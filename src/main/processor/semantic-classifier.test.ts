import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/mock/userData') },
}))

const mockSend = vi.fn()
vi.mock('@openrouter/sdk', () => ({
  OpenRouter: vi.fn().mockImplementation(function () {
    return { chat: { send: mockSend } }
  }),
}))

vi.mock('sharp', () => ({
  default: vi.fn().mockReturnValue({
    resize: vi.fn().mockReturnValue({
      jpeg: vi.fn().mockReturnValue({
        toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-image')),
      }),
    }),
  }),
}))

import { OpenRouter } from '@openrouter/sdk'
import { SemanticClassifierService } from './semantic-classifier'
import { UsageTracker } from '../services/usage-tracker'
import type { ActivityClassificationInput } from '../../shared/types'

describe('SemanticClassifierService', () => {
  let mockUsageTracker: UsageTracker

  beforeEach(() => {
    vi.clearAllMocks()
    mockUsageTracker = {
      recordUsage: vi.fn(),
      getStats: vi.fn().mockReturnValue({ requestCount: 0, totalCost: 0 }),
    } as unknown as UsageTracker
  })

  it('should create client without serverURL by default', () => {
    new SemanticClassifierService('test-key', undefined, undefined, mockUsageTracker)
    expect(OpenRouter).toHaveBeenCalledWith({ apiKey: 'test-key' })
  })

  it('should pass serverURL to OpenRouter when custom endpoint is provided', () => {
    new SemanticClassifierService('test-key', undefined, undefined, mockUsageTracker, null, {
      serverURL: 'http://localhost:11434/v1',
      model: 'llama3.2-vision',
    })
    expect(OpenRouter).toHaveBeenCalledWith({
      apiKey: 'test-key',
      serverURL: 'http://localhost:11434/v1',
    })
  })

  it('should use empty string as apiKey when custom endpoint has no key', () => {
    new SemanticClassifierService(undefined, undefined, undefined, mockUsageTracker, null, {
      serverURL: 'http://localhost:11434/v1',
      model: 'llama3.2-vision',
    })
    expect(OpenRouter).toHaveBeenCalledWith({
      apiKey: '',
      serverURL: 'http://localhost:11434/v1',
    })
  })

  it('should use custom endpoint apiKey over OpenRouter key', () => {
    new SemanticClassifierService('openrouter-key', undefined, undefined, mockUsageTracker, null, {
      serverURL: 'http://localhost:11434/v1',
      apiKey: 'custom-key',
      model: 'llama3.2-vision',
    })
    expect(OpenRouter).toHaveBeenCalledWith({
      apiKey: 'custom-key',
      serverURL: 'http://localhost:11434/v1',
    })
  })

  it('should forward custom model name in chat.send()', async () => {
    mockSend.mockResolvedValue({
      choices: [{ message: { content: 'Test summary' } }],
      usage: { promptTokens: 100, completionTokens: 20 },
    })

    const service = new SemanticClassifierService(
      undefined,
      undefined,
      undefined,
      mockUsageTracker,
      null,
      {
        serverURL: 'http://localhost:11434/v1',
        model: 'my-custom-model',
      },
    )

    const input: ActivityClassificationInput = {
      activity: {
        id: 'test-activity',
        startTimestamp: 1000,
        endTimestamp: 5000,
        appName: 'VS Code',
        windowTitle: 'index.ts',
        screenshots: [],
        interactions: [],
      },
      screenshotPaths: ['/tmp/start.png'],
      previousSummaries: [],
    }

    await service.classifyActivity(input)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ model: 'my-custom-model' }))
  })

  it('should track cost as 0 for custom endpoints', async () => {
    mockSend.mockResolvedValue({
      choices: [{ message: { content: 'Test summary' } }],
      usage: { promptTokens: 100, completionTokens: 20 },
    })

    const service = new SemanticClassifierService(
      undefined,
      undefined,
      undefined,
      mockUsageTracker,
      null,
      {
        serverURL: 'http://localhost:11434/v1',
        model: 'my-custom-model',
      },
    )

    const input: ActivityClassificationInput = {
      activity: {
        id: 'test-activity',
        startTimestamp: 1000,
        endTimestamp: 5000,
        appName: 'VS Code',
        windowTitle: 'index.ts',
        screenshots: [],
        interactions: [],
      },
      screenshotPaths: ['/tmp/start.png'],
      previousSummaries: [],
    }

    await service.classifyActivity(input)
    expect(mockUsageTracker.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ cost: 0 }))
  })

  it('should track cost normally for OpenRouter models', async () => {
    mockSend.mockResolvedValue({
      model: 'google/gemini-2.5-flash-lite-preview-09-2025',
      choices: [{ message: { content: 'Test summary' } }],
      usage: { promptTokens: 1_000_000, completionTokens: 1_000_000 },
    })

    const service = new SemanticClassifierService(
      'test-key',
      'google/gemini-2.5-flash-lite-preview-09-2025',
      undefined,
      mockUsageTracker,
    )

    const input: ActivityClassificationInput = {
      activity: {
        id: 'test-activity',
        startTimestamp: 1000,
        endTimestamp: 5000,
        appName: 'VS Code',
        windowTitle: 'index.ts',
        screenshots: [],
        interactions: [],
      },
      screenshotPaths: ['/tmp/start.png'],
      previousSummaries: [],
    }

    await service.classifyActivity(input)
    // gemini-2.5-flash-lite: 0.1 input + 0.4 output = 0.5
    expect(mockUsageTracker.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ cost: expect.closeTo(0.5, 2) }),
    )
  })

  it('should switch to custom endpoint via updateEndpoint()', () => {
    const service = new SemanticClassifierService(
      'test-key',
      undefined,
      undefined,
      mockUsageTracker,
    )
    expect(service.isUsingCustomEndpoint()).toBe(false)

    service.updateEndpoint({
      serverURL: 'http://localhost:11434/v1',
      model: 'llama3.2-vision',
    })
    expect(service.isUsingCustomEndpoint()).toBe(true)
    expect(service.isConfigured()).toBe(true)
  })

  it('should revert from custom endpoint via updateEndpoint(null)', () => {
    const service = new SemanticClassifierService(
      undefined,
      undefined,
      undefined,
      mockUsageTracker,
      null,
      {
        serverURL: 'http://localhost:11434/v1',
        model: 'llama3.2-vision',
      },
    )
    expect(service.isUsingCustomEndpoint()).toBe(true)

    service.updateEndpoint(null, 'openrouter-key')
    expect(service.isUsingCustomEndpoint()).toBe(false)
    expect(service.isConfigured()).toBe(true)
  })

  it('should revert to unconfigured when removing custom endpoint without OpenRouter key', () => {
    const service = new SemanticClassifierService(
      undefined,
      undefined,
      undefined,
      mockUsageTracker,
      null,
      {
        serverURL: 'http://localhost:11434/v1',
        model: 'llama3.2-vision',
      },
    )

    service.updateEndpoint(null)
    expect(service.isUsingCustomEndpoint()).toBe(false)
    expect(service.isConfigured()).toBe(false)
  })

  it('should report isConfigured() true when custom endpoint is set without OpenRouter key', () => {
    const service = new SemanticClassifierService(
      undefined,
      undefined,
      undefined,
      mockUsageTracker,
      null,
      {
        serverURL: 'http://localhost:11434/v1',
        model: 'llama3.2-vision',
      },
    )
    expect(service.isConfigured()).toBe(true)
  })

  it('should ignore updateApiKey when custom endpoint is active', () => {
    const service = new SemanticClassifierService(
      undefined,
      undefined,
      undefined,
      mockUsageTracker,
      null,
      {
        serverURL: 'http://localhost:11434/v1',
        model: 'llama3.2-vision',
      },
    )
    // Should not crash or change state
    service.updateApiKey('new-key')
    expect(service.isUsingCustomEndpoint()).toBe(true)
  })

  it('should return expected summary from classifyActivity()', async () => {
    mockSend.mockResolvedValue({
      choices: [{ message: { content: '  User opened a new tab  ' } }],
      usage: { promptTokens: 100, completionTokens: 20 },
    })

    const service = new SemanticClassifierService(
      'test-key',
      undefined,
      undefined,
      mockUsageTracker,
    )

    const input: ActivityClassificationInput = {
      activity: {
        id: 'test-activity',
        startTimestamp: 1000,
        endTimestamp: 5000,
        appName: 'VS Code',
        windowTitle: 'index.ts',
        screenshots: [],
        interactions: [],
      },
      screenshotPaths: ['/tmp/start.png'],
      previousSummaries: [],
    }

    const result = await service.classifyActivity(input)
    expect(result).toBe('User opened a new tab')
  })

  it('should use models array with fallback route for OpenRouter calls', async () => {
    mockSend.mockResolvedValue({
      model: 'google/gemini-2.5-flash-lite-preview-09-2025',
      choices: [{ message: { content: 'Test summary' } }],
      usage: { promptTokens: 100, completionTokens: 20 },
    })

    const service = new SemanticClassifierService(
      'test-key',
      undefined,
      undefined,
      mockUsageTracker,
    )

    const input: ActivityClassificationInput = {
      activity: {
        id: 'test-activity',
        startTimestamp: 1000,
        endTimestamp: 5000,
        appName: 'VS Code',
        windowTitle: 'index.ts',
        screenshots: [],
        interactions: [],
      },
      screenshotPaths: ['/tmp/start.png'],
      previousSummaries: [],
    }

    await service.classifyActivity(input)

    const sendArgs = mockSend.mock.calls[0][0]
    expect(sendArgs.models).toEqual([
      'google/gemini-2.5-flash-lite-preview-09-2025',
      'qwen/qwen3.5-397b-a17b',
    ])
    expect(sendArgs.route).toBe('fallback')
    expect(sendArgs.model).toBeUndefined()
    expect(sendArgs.provider).toBeUndefined()
  })
})
