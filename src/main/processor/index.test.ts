import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventProcessor } from './index'
import { EmbeddingService } from './embedding'
import { StorageService } from './storage'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as ocr from './ocr'

// Mock dependencies
vi.mock('fs')
vi.mock('./ocr')

describe('EventProcessor', () => {
  const existingScreenshotPath = path.join(os.tmpdir(), 'memorylane-test.png')
  const ocrFailureScreenshotPath = path.join(os.tmpdir(), 'memorylane-ocr-failure.png')
  const missingScreenshotPath = path.join(os.tmpdir(), 'memorylane-missing.png')

  let processor: EventProcessor
  let mockEmbeddingService: EmbeddingService
  let mockStorageService: StorageService

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

    processor = new EventProcessor(mockEmbeddingService, mockStorageService)
  })

  it('should process a screenshot successfully', async () => {
    const screenshot = {
      id: 'test-id',
      filepath: existingScreenshotPath,
      timestamp: 123456,
      display: { id: 1, width: 1920, height: 1080 },
    }

    // Setup mocks behavior
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(ocr.extractText).mockResolvedValue('Detected Text')
    // fs.unlinkSync is void, no return needed

    // Run
    await processor.processScreenshot(screenshot)

    // Verify Pipeline Steps
    // 1. OCR
    expect(ocr.extractText).toHaveBeenCalledWith(screenshot.filepath)

    // 2. Embedding
    expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith('Detected Text')

    // 3. Storage
    expect(mockStorageService.addEvent).toHaveBeenCalledWith({
      appName: '',
      id: screenshot.id,
      timestamp: screenshot.timestamp,
      text: 'Detected Text',
      summary: '',
      vector: [0.1, 0.2, 0.3],
    })

    // 4. Cleanup
    expect(fs.unlinkSync).toHaveBeenCalledWith(screenshot.filepath)
  })

  it('should continue processing when OCR fails', async () => {
    const screenshot = {
      id: 'ocr-failure-id',
      filepath: ocrFailureScreenshotPath,
      timestamp: 123456,
      display: { id: 1, width: 1920, height: 1080 },
    }

    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(ocr.extractText).mockRejectedValue(new Error('OCR backend unavailable'))

    await processor.processScreenshot(screenshot)

    expect(ocr.extractText).toHaveBeenCalledWith(screenshot.filepath)
    expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith('')
    expect(mockStorageService.addEvent).toHaveBeenCalledWith({
      appName: '',
      id: screenshot.id,
      timestamp: screenshot.timestamp,
      text: '',
      summary: '',
      vector: [0.1, 0.2, 0.3],
    })
    expect(fs.unlinkSync).toHaveBeenCalledWith(screenshot.filepath)
  })

  it('should skip processing if file does not exist', async () => {
    const screenshot = {
      id: 'missing-id',
      filepath: missingScreenshotPath,
      timestamp: 123456,
      display: { id: 1, width: 100, height: 100 },
    }

    vi.mocked(fs.existsSync).mockReturnValue(false)

    await processor.processScreenshot(screenshot)

    expect(ocr.extractText).not.toHaveBeenCalled()
    expect(mockStorageService.addEvent).not.toHaveBeenCalled()
  })
})
