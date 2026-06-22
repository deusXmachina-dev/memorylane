import { describe, expect, it, vi } from 'vitest'
import { DefaultActivityTransformer } from './activity-transformer'
import type { Activity, ActivityFrame } from './activity-types'
import type {
  ActivityVideoStitcher,
  ActivityOcrService,
  ActivitySemanticService,
  ActivityEmbeddingService,
  ActivityVideoAsset,
} from './activity-transformer-types'
import type { Frame } from './recorder/screen-capturer'
import log from './logger'

vi.mock('./logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function makeFrame(index: number): ActivityFrame {
  return {
    offset: index,
    frame: {
      filepath: `/screenshots/frame-${index}.png`,
      timestamp: 1000 + index * 100,
      width: 1920,
      height: 1080,
      displayId: 1,
      sequenceNumber: index,
    } satisfies Frame,
  }
}

function makeActivity(
  frameCount: number,
  interactions: Activity['interactions'] = [{ type: 'click', timestamp: 1500 }],
): Activity {
  return {
    id: 'activity-1',
    startTimestamp: 1000,
    endTimestamp: 2000,
    context: {
      appName: 'Code',
      bundleId: 'com.microsoft.VSCode',
      windowTitle: 'Editor',
      tld: 'github.com',
    },
    interactions,
    frames: Array.from({ length: frameCount }, (_, i) => makeFrame(i)),
    provenance: {
      eventWindowOffsets: [],
      frameOffsets: [],
      sourceWindowIds: [],
      sourceClosedBy: [],
    },
  }
}

function makeDeps() {
  const stitcher: ActivityVideoStitcher = {
    stitch: vi.fn().mockResolvedValue({
      videoPath: '/output/activity-1.mp4',
      frameCount: 3,
      durationMs: 300,
    } satisfies ActivityVideoAsset),
  }

  const ocr: ActivityOcrService = {
    extractText: vi.fn().mockResolvedValue('ocr text'),
  }

  const semantic: ActivitySemanticService = {
    summarizeFromVideo: vi
      .fn()
      .mockResolvedValue({ summary: 'A summary of the activity', model: 'test-model' }),
  }

  const embedder: ActivityEmbeddingService = {
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  }

  return { stitcher, ocr, semantic, embedder }
}

const OUTPUT_DIR = '/output'

describe('DefaultActivityTransformer', () => {
  it('calls all deps in correct order with correct args', async () => {
    const { stitcher, ocr, semantic, embedder } = makeDeps()
    const transformer = new DefaultActivityTransformer(stitcher, ocr, semantic, embedder, {
      outputDir: OUTPUT_DIR,
    })

    const activity = makeActivity(3)
    const result = await transformer.transform(activity)

    // Stitcher called with correct frame inputs
    expect(stitcher.stitch).toHaveBeenCalledOnce()
    expect(stitcher.stitch).toHaveBeenCalledWith({
      activityId: 'activity-1',
      frames: [
        { filepath: '/screenshots/frame-0.png', timestamp: 1000, width: 1920, height: 1080 },
        { filepath: '/screenshots/frame-1.png', timestamp: 1100, width: 1920, height: 1080 },
        { filepath: '/screenshots/frame-2.png', timestamp: 1200, width: 1920, height: 1080 },
      ],
      outputPath: '/output/activity-1.mp4',
    })

    // OCR called once for the selected frame (fallback to first when < 5 frames)
    expect(ocr.extractText).toHaveBeenCalledTimes(1)
    expect(ocr.extractText).toHaveBeenCalledWith('/screenshots/frame-0.png')

    // Semantic called with video path and OCR text
    expect(semantic.summarizeFromVideo).toHaveBeenCalledOnce()
    expect(semantic.summarizeFromVideo).toHaveBeenCalledWith({
      activity,
      videoPath: '/output/activity-1.mp4',
    })

    // Embedder called with the summary
    expect(embedder.embed).toHaveBeenCalledOnce()
    expect(embedder.embed).toHaveBeenCalledWith('A summary of the activity')

    // Result has all fields mapped correctly
    expect(result).toEqual({
      activityId: 'activity-1',
      startTimestamp: 1000,
      endTimestamp: 2000,
      appName: 'Code',
      windowTitle: 'Editor',
      tld: 'github.com',
      summary: 'A summary of the activity',
      summaryModel: 'test-model',
      ocrText: 'ocr text',
      vector: [0.1, 0.2, 0.3],
    })
  })

  it('skips video stitching when pipeline preference is image', async () => {
    const { stitcher, ocr, semantic, embedder } = makeDeps()
    const transformer = new DefaultActivityTransformer(stitcher, ocr, semantic, embedder, {
      outputDir: OUTPUT_DIR,
      getPipelinePreference: () => 'image',
    })

    const activity = makeActivity(3)
    await transformer.transform(activity)

    expect(stitcher.stitch).not.toHaveBeenCalled()
    expect(semantic.summarizeFromVideo).toHaveBeenCalledWith({
      activity,
      videoPath: undefined,
    })
  })

  it('uses the 5th screenshot from the end for OCR when there are at least 5 frames', async () => {
    const { stitcher, ocr, semantic, embedder } = makeDeps()
    ;(ocr.extractText as ReturnType<typeof vi.fn>).mockResolvedValue('Selected OCR text')

    const transformer = new DefaultActivityTransformer(stitcher, ocr, semantic, embedder, {
      outputDir: OUTPUT_DIR,
    })

    const result = await transformer.transform(makeActivity(7))
    expect(ocr.extractText).toHaveBeenCalledTimes(1)
    expect(ocr.extractText).toHaveBeenCalledWith('/screenshots/frame-2.png')
    expect(result.ocrText).toBe('Selected OCR text')
  })

  it('falls back to embedding ocrText when summary is empty', async () => {
    const { stitcher, ocr, semantic, embedder } = makeDeps()
    ;(semantic.summarizeFromVideo as ReturnType<typeof vi.fn>).mockResolvedValue({
      summary: '',
      model: '',
    })

    const transformer = new DefaultActivityTransformer(stitcher, ocr, semantic, embedder, {
      outputDir: OUTPUT_DIR,
    })

    const activity = makeActivity(2)
    await transformer.transform(activity)

    expect(embedder.embed).toHaveBeenCalledWith('ocr text')
  })

  it('handles activity with no frames', async () => {
    const { stitcher, ocr, semantic, embedder } = makeDeps()
    const transformer = new DefaultActivityTransformer(stitcher, ocr, semantic, embedder, {
      outputDir: OUTPUT_DIR,
    })

    const activity = makeActivity(0)
    const result = await transformer.transform(activity)

    expect(stitcher.stitch).toHaveBeenCalledWith({
      activityId: 'activity-1',
      frames: [],
      outputPath: '/output/activity-1.mp4',
    })
    expect(ocr.extractText).not.toHaveBeenCalled()
    expect(result.ocrText).toBe('')
  })

  describe('passive view (no clicks/keys/scrolls)', () => {
    it.each([
      ['empty interactions', []],
      ['app_change only', [{ type: 'app_change' as const, timestamp: 1500 }]],
      [
        'app_change + presence heartbeats',
        [
          { type: 'app_change' as const, timestamp: 1100 },
          { type: 'presence' as const, timestamp: 1500 },
          { type: 'presence' as const, timestamp: 1900 },
        ],
      ],
    ])('skips the LLM and labels "Viewed <title>" for %s', async (_name, interactions) => {
      const { stitcher, ocr, semantic, embedder } = makeDeps()
      const transformer = new DefaultActivityTransformer(stitcher, ocr, semantic, embedder, {
        outputDir: OUTPUT_DIR,
      })

      const activity = makeActivity(3, interactions)
      const result = await transformer.transform(activity)

      expect(semantic.summarizeFromVideo).not.toHaveBeenCalled()
      expect(result.summary).toBe('Viewed Editor')
      expect(result.summaryModel).toBe('heuristic:viewed')
      // Embeds the on-screen content, not the "Viewed X" label, so it stays findable.
      expect(embedder.embed).toHaveBeenCalledWith('ocr text')
      expect(result.ocrText).toBe('ocr text')
    })

    it('still stitches video so the activity remains viewable', async () => {
      const { stitcher, ocr, semantic, embedder } = makeDeps()
      const transformer = new DefaultActivityTransformer(stitcher, ocr, semantic, embedder, {
        outputDir: OUTPUT_DIR,
      })

      await transformer.transform(makeActivity(3, []))
      expect(stitcher.stitch).toHaveBeenCalledOnce()
    })

    it('sends scroll-only activities to the LLM (scroll is engagement, not passive)', async () => {
      const { stitcher, ocr, semantic, embedder } = makeDeps()
      const transformer = new DefaultActivityTransformer(stitcher, ocr, semantic, embedder, {
        outputDir: OUTPUT_DIR,
      })

      const result = await transformer.transform(
        makeActivity(3, [{ type: 'scroll', timestamp: 1500, scrollDirection: 'vertical' }]),
      )

      expect(semantic.summarizeFromVideo).toHaveBeenCalledOnce()
      expect(result.summary).toBe('A summary of the activity')
    })

    it('OCRs a single settled frame (no scrolling means the screen is static)', async () => {
      const { stitcher, ocr, semantic, embedder } = makeDeps()
      ;(ocr.extractText as ReturnType<typeof vi.fn>).mockResolvedValue('Reference content')

      const transformer = new DefaultActivityTransformer(stitcher, ocr, semantic, embedder, {
        outputDir: OUTPUT_DIR,
      })

      const result = await transformer.transform(makeActivity(10, []))

      // Same single-frame OCR as the LLM path: 5th frame from the end.
      expect(ocr.extractText).toHaveBeenCalledTimes(1)
      expect(ocr.extractText).toHaveBeenCalledWith('/screenshots/frame-5.png')
      expect(result.ocrText).toBe('Reference content')
      expect(embedder.embed).toHaveBeenCalledWith('Reference content')
    })

    it('falls back to the label for embedding when OCR yields nothing', async () => {
      const { stitcher, ocr, semantic, embedder } = makeDeps()
      ;(ocr.extractText as ReturnType<typeof vi.fn>).mockResolvedValue('')

      const transformer = new DefaultActivityTransformer(stitcher, ocr, semantic, embedder, {
        outputDir: OUTPUT_DIR,
      })

      const result = await transformer.transform(makeActivity(2, []))

      expect(result.ocrText).toBe('')
      expect(embedder.embed).toHaveBeenCalledWith('Viewed Editor')
    })
  })

  describe('error propagation', () => {
    it('propagates stitcher errors', async () => {
      const { stitcher, ocr, semantic, embedder } = makeDeps()
      ;(stitcher.stitch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('stitch failed'))

      const transformer = new DefaultActivityTransformer(stitcher, ocr, semantic, embedder, {
        outputDir: OUTPUT_DIR,
      })

      await expect(transformer.transform(makeActivity(1))).rejects.toThrow('stitch failed')
    })

    it('continues when OCR errors', async () => {
      const { stitcher, ocr, semantic, embedder } = makeDeps()
      ;(ocr.extractText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ocr failed'))

      const transformer = new DefaultActivityTransformer(stitcher, ocr, semantic, embedder, {
        outputDir: OUTPUT_DIR,
      })

      await expect(transformer.transform(makeActivity(1))).resolves.toEqual(
        expect.objectContaining({
          summary: 'A summary of the activity',
          ocrText: '',
        }),
      )
      expect(semantic.summarizeFromVideo).toHaveBeenCalledWith({
        activity: makeActivity(1),
        videoPath: '/output/activity-1.mp4',
      })
      expect(embedder.embed).toHaveBeenCalledWith('A summary of the activity')
      expect(log.warn).toHaveBeenCalled()
    })

    it('falls back to empty OCR text for embedding when OCR and summary both fail soft', async () => {
      const { stitcher, ocr, semantic, embedder } = makeDeps()
      ;(ocr.extractText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ocr failed'))
      ;(semantic.summarizeFromVideo as ReturnType<typeof vi.fn>).mockResolvedValue({
        summary: '',
        model: '',
      })

      const transformer = new DefaultActivityTransformer(stitcher, ocr, semantic, embedder, {
        outputDir: OUTPUT_DIR,
      })

      await transformer.transform(makeActivity(1))

      expect(embedder.embed).toHaveBeenCalledWith('')
    })

    it('propagates semantic errors', async () => {
      const { stitcher, ocr, semantic, embedder } = makeDeps()
      ;(semantic.summarizeFromVideo as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('semantic failed'),
      )

      const transformer = new DefaultActivityTransformer(stitcher, ocr, semantic, embedder, {
        outputDir: OUTPUT_DIR,
      })

      await expect(transformer.transform(makeActivity(1))).rejects.toThrow('semantic failed')
    })

    it('propagates embedder errors', async () => {
      const { stitcher, ocr, semantic, embedder } = makeDeps()
      ;(embedder.embed as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('embed failed'))

      const transformer = new DefaultActivityTransformer(stitcher, ocr, semantic, embedder, {
        outputDir: OUTPUT_DIR,
      })

      await expect(transformer.transform(makeActivity(1))).rejects.toThrow('embed failed')
    })
  })
})
