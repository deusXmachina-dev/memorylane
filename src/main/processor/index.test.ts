import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ActivityProcessor } from './index'
import { EmbeddingService } from './embedding'
import { StorageService } from './storage'
import { SemanticClassifierService } from './semantic-classifier'
import * as fs from 'fs'
import * as ocr from './ocr'
import { Activity } from '../../shared/types'

// Mock dependencies
vi.mock('fs')
vi.mock('./ocr')
vi.mock('@constants', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    OCR_CONFIG: {
      ...(actual.OCR_CONFIG as Record<string, unknown>),
      ENABLED: true,
    },
  }
})

function createActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: overrides.id ?? 'activity-1',
    startTimestamp: overrides.startTimestamp ?? 1000,
    endTimestamp: overrides.endTimestamp ?? 5000,
    appName: overrides.appName ?? 'VS Code',
    windowTitle: overrides.windowTitle ?? 'index.ts',
    screenshots: overrides.screenshots ?? [
      {
        id: 'ss-1',
        filepath: '/tmp/ss-1.png',
        timestamp: 1000,
        trigger: 'activity_start',
        display: { id: 1, width: 1920, height: 1080 },
      },
      {
        id: 'ss-2',
        filepath: '/tmp/ss-2.png',
        timestamp: 5000,
        trigger: 'activity_end',
        display: { id: 1, width: 1920, height: 1080 },
      },
    ],
    interactions: overrides.interactions ?? [],
  }
}

describe('ActivityProcessor', () => {
  let processor: ActivityProcessor
  let mockEmbeddingService: EmbeddingService
  let mockStorageService: StorageService
  let mockClassifierService: SemanticClassifierService

  beforeEach(() => {
    vi.resetAllMocks()

    mockEmbeddingService = {
      generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      init: vi.fn(),
    } as unknown as EmbeddingService

    mockStorageService = {
      addActivity: vi.fn().mockResolvedValue(undefined),
      init: vi.fn(),
      close: vi.fn(),
    } as unknown as StorageService

    mockClassifierService = {
      classifyActivity: vi.fn().mockResolvedValue('User edited index.ts in VS Code'),
      getSummaryHistory: vi.fn().mockReturnValue([]),
      isConfigured: vi.fn().mockReturnValue(true),
    } as unknown as SemanticClassifierService

    processor = new ActivityProcessor(
      mockEmbeddingService,
      mockStorageService,
      mockClassifierService,
    )
  })

  it('should process an activity: OCR, classify, embed, store, cleanup', async () => {
    const activity = createActivity()

    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(ocr.extractText).mockResolvedValue('Detected Text')

    await processor.processActivity(activity)

    // OCR ran on both screenshots
    expect(ocr.extractText).toHaveBeenCalledTimes(2)
    expect(ocr.extractText).toHaveBeenCalledWith('/tmp/ss-1.png')
    expect(ocr.extractText).toHaveBeenCalledWith('/tmp/ss-2.png')

    // Classifier was called with screenshots
    expect(mockClassifierService.classifyActivity).toHaveBeenCalledWith({
      activity,
      screenshotPaths: ['/tmp/ss-1.png', '/tmp/ss-2.png'],
      previousSummaries: [],
    })

    // Embedding generated from summary
    expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith(
      'User edited index.ts in VS Code',
    )

    // Stored as activity
    expect(mockStorageService.addActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'activity-1',
        appName: 'VS Code',
        windowTitle: 'index.ts',
        summary: 'User edited index.ts in VS Code',
        ocrText: 'Detected Text\n---\nDetected Text',
        screenshotCount: 2,
        vector: [0.1, 0.2, 0.3],
      }),
    )

    // Screenshot files deleted
    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/ss-1.png')
    expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/ss-2.png')
  })

  it('should continue processing when OCR fails', async () => {
    const activity = createActivity()

    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(ocr.extractText).mockRejectedValue(new Error('OCR backend unavailable'))

    await processor.processActivity(activity)

    // OCR attempted
    expect(ocr.extractText).toHaveBeenCalledTimes(2)

    // Classifier still called
    expect(mockClassifierService.classifyActivity).toHaveBeenCalled()

    // Storage still called with empty OCR text
    expect(mockStorageService.addActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        ocrText: '\n---\n',
      }),
    )

    // Cleanup still runs
    expect(fs.unlinkSync).toHaveBeenCalledTimes(2)
  })

  it('should skip OCR for missing screenshot files', async () => {
    const activity = createActivity()

    vi.mocked(fs.existsSync).mockReturnValue(false)

    await processor.processActivity(activity)

    // OCR not called since files don't exist
    expect(ocr.extractText).not.toHaveBeenCalled()

    // Still classified and stored
    expect(mockClassifierService.classifyActivity).toHaveBeenCalled()
    expect(mockStorageService.addActivity).toHaveBeenCalled()
  })
})
