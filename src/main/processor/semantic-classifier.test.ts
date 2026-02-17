import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'

// Mock dependencies
vi.mock('fs')
vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/mock/userData') },
}))

const mockSend = vi.fn()
vi.mock('@openrouter/sdk', () => ({
  OpenRouter: vi.fn().mockImplementation(function () {
    return { chat: { send: mockSend } }
  }),
}))

import { OpenRouter } from '@openrouter/sdk'
import { SemanticClassifierService } from './semantic-classifier'
import { UsageTracker } from '../services/usage-tracker'
import type { ClassificationInput } from '../../shared/types'

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
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake-image'))
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

    const input: ClassificationInput = {
      startScreenshot: {
        id: 'start-1',
        filepath: '/tmp/start.png',
        timestamp: 1000,
        display: { id: 1, width: 1920, height: 1080 },
        trigger: { type: 'manual' },
      },
      events: [],
    }

    await service.classify(input)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ model: 'my-custom-model' }))
  })

  it('should track cost as 0 for custom endpoints', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake-image'))
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

    const input: ClassificationInput = {
      startScreenshot: {
        id: 'start-1',
        filepath: '/tmp/start.png',
        timestamp: 1000,
        display: { id: 1, width: 1920, height: 1080 },
        trigger: { type: 'manual' },
      },
      events: [],
    }

    await service.classify(input)
    expect(mockUsageTracker.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ cost: 0 }))
  })

  it('should track cost normally for OpenRouter models', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake-image'))
    mockSend.mockResolvedValue({
      choices: [{ message: { content: 'Test summary' } }],
      usage: { promptTokens: 1_000_000, completionTokens: 1_000_000 },
    })

    const service = new SemanticClassifierService(
      'test-key',
      'mistralai/mistral-small-3.2-24b-instruct',
      undefined,
      mockUsageTracker,
    )

    const input: ClassificationInput = {
      startScreenshot: {
        id: 'start-1',
        filepath: '/tmp/start.png',
        timestamp: 1000,
        display: { id: 1, width: 1920, height: 1080 },
        trigger: { type: 'manual' },
      },
      events: [],
    }

    await service.classify(input)
    // mistral-small: 0.08 input + 0.2 output = 0.28
    expect(mockUsageTracker.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ cost: expect.closeTo(0.28, 2) }),
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

  it('should return expected summary from classify()', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake-image'))
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

    const input: ClassificationInput = {
      startScreenshot: {
        id: 'start-1',
        filepath: '/tmp/start.png',
        timestamp: 1000,
        display: { id: 1, width: 1920, height: 1080 },
        trigger: { type: 'manual' },
      },
      events: [],
    }

    const result = await service.classify(input)
    expect(result).toBe('User opened a new tab')
  })
})
