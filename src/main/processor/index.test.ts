import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventProcessor } from './index'
import { EmbeddingService } from './embedding'
import { StorageService } from './storage'
import { SemanticClassifierService } from './semantic-classifier'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as ocr from './ocr'

// Mock dependencies
vi.mock('fs')
vi.mock('./ocr')

describe('EventProcessor', () => {
  const firstScreenshotPath = path.join(os.tmpdir(), 'memorylane-first.png')
  const secondScreenshotPath = path.join(os.tmpdir(), 'memorylane-second.png')

  let processor: EventProcessor
  let mockEmbeddingService: EmbeddingService
  let mockStorageService: StorageService
  let mockClassifierService: SemanticClassifierService

  beforeEach(() => {
    // Reset mocks
    vi.resetAllMocks()

    // Create manual mocks for services (since they are classes)
    mockEmbeddingService = {
      generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      init: vi.fn(),
    } as unknown as EmbeddingService

    mockStorageService = {
      addEvent: vi.fn().mockResolvedValue(undefined),
      init: vi.fn(),
      getEventById: vi.fn(),
      close: vi.fn(),
    } as unknown as StorageService

    mockClassifierService = {
      summarizeSession: vi.fn().mockResolvedValue(''),
      classify: vi.fn(),
      getSummaryHistory: vi.fn(),
      getUsageTracker: vi.fn(),
    } as unknown as SemanticClassifierService

    processor = new EventProcessor(mockEmbeddingService, mockStorageService)
  })

  it('processes one session into one stored event', async () => {
    const session = {
      sessionId: 'session-1',
      appName: 'Cursor',
      startTimestamp: 1000,
      endTimestamp: 2500,
      endReason: 'app_switch' as const,
      screenshots: [
        {
          id: 's1',
          filepath: firstScreenshotPath,
          timestamp: 1000,
          display: { id: 1, width: 1920, height: 1080 },
          trigger: { type: 'manual' as const },
        },
        {
          id: 's2',
          filepath: secondScreenshotPath,
          timestamp: 2000,
          display: { id: 1, width: 1920, height: 1080 },
          trigger: { type: 'baseline_change' as const, confidence: 14.1 },
        },
      ],
      interactionEvents: [
        { type: 'keyboard' as const, timestamp: 1800, keyCount: 12, durationMs: 900 },
      ],
    }

    // Setup mocks behavior
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(ocr.extractText)
      .mockResolvedValueOnce('First OCR text')
      .mockResolvedValueOnce('Second OCR text')

    // Run
    await processor.processSession(session)

    const expectedText =
      '[FRAME 1/2] timestamp=1000 id=s1\n' +
      'First OCR text\n\n' +
      '[FRAME 2/2] timestamp=2000 id=s2\n' +
      'Second OCR text'

    expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith(expectedText)
    expect(mockStorageService.addEvent).toHaveBeenCalledWith({
      id: 'session-1',
      timestamp: 1000,
      text: expectedText,
      summary: '',
      appName: 'Cursor',
      vector: [0.1, 0.2, 0.3],
    })
    expect(fs.unlinkSync).toHaveBeenCalledWith(firstScreenshotPath)
    expect(fs.unlinkSync).toHaveBeenCalledWith(secondScreenshotPath)
  })

  it('uses summary as embedding source when session summary succeeds', async () => {
    processor = new EventProcessor(mockEmbeddingService, mockStorageService, mockClassifierService)
    vi.mocked(mockClassifierService.summarizeSession).mockResolvedValue(
      'Implemented session aggregation and updated processor tests.',
    )

    const session = {
      sessionId: 'session-summary',
      appName: 'Cursor',
      startTimestamp: 3000,
      endTimestamp: 4000,
      endReason: 'stop' as const,
      screenshots: [
        {
          id: 's3',
          filepath: firstScreenshotPath,
          timestamp: 3000,
          display: { id: 1, width: 1920, height: 1080 },
          trigger: { type: 'manual' as const },
        },
      ],
      interactionEvents: [],
    }

    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(ocr.extractText).mockResolvedValue('Fallback OCR text')

    await processor.processSession(session)

    expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith(
      'Implemented session aggregation and updated processor tests.',
    )
    expect(mockStorageService.addEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'session-summary',
        summary: 'Implemented session aggregation and updated processor tests.',
      }),
    )
  })

  it('falls back to OCR embedding source when summary fails', async () => {
    processor = new EventProcessor(mockEmbeddingService, mockStorageService, mockClassifierService)
    vi.mocked(mockClassifierService.summarizeSession).mockRejectedValue(new Error('LLM timeout'))

    vi.mocked(fs.existsSync).mockReturnValue(false)
    const session = {
      sessionId: 'session-fallback',
      appName: 'Terminal',
      startTimestamp: 5000,
      endTimestamp: 5000,
      endReason: 'stop' as const,
      screenshots: [
        {
          id: 's4',
          filepath: firstScreenshotPath,
          timestamp: 5000,
          display: { id: 1, width: 100, height: 100 },
          trigger: { type: 'manual' as const },
        },
      ],
      interactionEvents: [],
    }

    await processor.processSession(session)

    const expectedText = '[FRAME 1/1] timestamp=5000 id=s4\n[NO_OCR_TEXT]'
    expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith(expectedText)
    expect(mockStorageService.addEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'session-fallback',
        summary: '',
        text: expectedText,
      }),
    )
    expect(fs.unlinkSync).not.toHaveBeenCalled()
  })

  it('does not delete screenshots when storage fails', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(ocr.extractText).mockResolvedValue('OCR text')
    vi.mocked(mockStorageService.addEvent).mockRejectedValue(new Error('db down'))

    const session = {
      sessionId: 'session-db-failure',
      appName: 'Cursor',
      startTimestamp: 7000,
      endTimestamp: 7100,
      endReason: 'stop' as const,
      screenshots: [
        {
          id: 's5',
          filepath: secondScreenshotPath,
          timestamp: 7000,
          display: { id: 1, width: 100, height: 100 },
          trigger: { type: 'manual' as const },
        },
      ],
      interactionEvents: [],
    }

    await expect(processor.processSession(session)).rejects.toThrow('db down')

    expect(mockStorageService.addEvent).toHaveBeenCalledTimes(3)
    expect(fs.unlinkSync).not.toHaveBeenCalled()
  })
})
