import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventProcessor } from './index';
import { EmbeddingService } from './embedding';
import { StorageService } from './storage';
import * as fs from 'fs';
import * as ocr from './ocr';

// Mock dependencies
vi.mock('fs');
vi.mock('./ocr');

describe('EventProcessor', () => {
  let processor: EventProcessor;
  let mockEmbeddingService: EmbeddingService;
  let mockStorageService: StorageService;

  beforeEach(() => {
    // Reset mocks
    vi.resetAllMocks();

    // Create manual mocks for services (since they are classes)
    mockEmbeddingService = {
      generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      init: vi.fn(),
    } as unknown as EmbeddingService;

    mockStorageService = {
      addEvent: vi.fn().mockResolvedValue(undefined),
      init: vi.fn(),
      getEventById: vi.fn(),
      close: vi.fn(),
    } as unknown as StorageService;

    processor = new EventProcessor(mockEmbeddingService, mockStorageService);
  });

  it('should process a screenshot successfully', async () => {
    const screenshot = {
      id: 'test-id',
      filepath: '/tmp/test.png',
      timestamp: 123456,
      display: { id: 1, width: 1920, height: 1080 }
    };

    // Setup mocks behavior
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(ocr.extractText).mockResolvedValue('Detected Text');
    // fs.unlinkSync is void, no return needed

    // Run
    await processor.processScreenshot(screenshot);

    // Verify Pipeline Steps
    // 1. OCR
    expect(ocr.extractText).toHaveBeenCalledWith(screenshot.filepath);
    
    // 2. Embedding
    expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith('Detected Text');
    
    // 3. Storage
    expect(mockStorageService.addEvent).toHaveBeenCalledWith({
      id: screenshot.id,
      timestamp: screenshot.timestamp,
      text: 'Detected Text',
      vector: [0.1, 0.2, 0.3],
    });

    // 4. Cleanup
    expect(fs.unlinkSync).toHaveBeenCalledWith(screenshot.filepath);
  });

  it('should skip processing if file does not exist', async () => {
    const screenshot = {
      id: 'missing-id',
      filepath: '/tmp/missing.png',
      timestamp: 123456,
      display: { id: 1, width: 100, height: 100 }
    };

    vi.mocked(fs.existsSync).mockReturnValue(false);

    await processor.processScreenshot(screenshot);

    expect(ocr.extractText).not.toHaveBeenCalled();
    expect(mockStorageService.addEvent).not.toHaveBeenCalled();
  });
});
