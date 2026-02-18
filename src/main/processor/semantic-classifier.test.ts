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

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual }
})

import * as fs from 'fs'
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
      choices: [{ message: { content: 'Test summary' } }],
      usage: { promptTokens: 1_000_000, completionTokens: 1_000_000 },
    })

    const service = new SemanticClassifierService(
      'test-key',
      'google/gemini-2.5-flash-lite',
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

  it('should send video content block when videoPath is provided', async () => {
    mockSend.mockResolvedValue({
      choices: [{ message: { content: 'Video summary' } }],
      usage: { promptTokens: 100, completionTokens: 20 },
    })

    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('fake-video-data'))

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
      videoPath: '/tmp/video.mp4',
      previousSummaries: [],
    }

    await service.classifyActivity(input)

    const sentContent = mockSend.mock.calls[0][0].messages[0].content
    // Should have text prompt + video content block (no screenshot blocks)
    expect(sentContent).toHaveLength(2)
    expect(sentContent[0].type).toBe('text')
    expect(sentContent[1].type).toBe('image_url')
    expect(sentContent[1].imageUrl.url).toMatch(/^data:video\/mp4;base64,/)
    // Prompt should reference video
    expect(sentContent[0].text).toContain('video')
    expect(sentContent[0].text).not.toContain('[S1]')
  })

  it('should fall back to screenshots when videoPath is missing', async () => {
    mockSend.mockResolvedValue({
      choices: [{ message: { content: 'Screenshot summary' } }],
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

    const sentContent = mockSend.mock.calls[0][0].messages[0].content
    // Should have text prompt + screenshot image block(s)
    expect(sentContent[0].type).toBe('text')
    expect(sentContent[0].text).toContain('screenshots')
    expect(sentContent[0].text).not.toContain('video is the primary source')
    // Screenshot block should be JPEG
    expect(sentContent[1].imageUrl.url).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('should fall back to screenshots when video file does not exist', async () => {
    mockSend.mockResolvedValue({
      choices: [{ message: { content: 'Screenshot summary' } }],
      usage: { promptTokens: 100, completionTokens: 20 },
    })

    vi.spyOn(fs, 'existsSync').mockReturnValue(false)

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
      videoPath: '/tmp/nonexistent.mp4',
      previousSummaries: [],
    }

    await service.classifyActivity(input)

    const sentContent = mockSend.mock.calls[0][0].messages[0].content
    // Should fall back to screenshot mode
    expect(sentContent[0].text).toContain('screenshots')
  })
})
