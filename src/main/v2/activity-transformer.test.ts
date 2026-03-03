import { describe, expect, it, vi } from 'vitest'
import { DefaultActivityTransformer } from './activity-transformer'
import type { V2Activity, V2ActivityFrame } from './activity-types'
import type {
  ActivityVideoStitcher,
  ActivityOcrService,
  ActivitySemanticService,
  ActivityEmbeddingService,
  ActivityVideoAsset,
} from './activity-transformer-types'
import type { Frame } from './recorder/screen-capturer'
import log from '../logger'

vi.mock('../logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

function makeFrame(index: number): V2ActivityFrame {
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

function makeActivity(frameCount: number): V2Activity {
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
    interactions: [],
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
    summarizeFromVideo: vi.fn().mockResolvedValue('A summary of the activity'),
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
        { filepath: '/screenshots/frame-0.png', timestamp: 1000 },
        { filepath: '/screenshots/frame-1.png', timestamp: 1100 },
        { filepath: '/screenshots/frame-2.png', timestamp: 1200 },
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
      ocrText: 'ocr text',
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
      ocrText: 'ocr text',
      vector: [0.1, 0.2, 0.3],
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
    ;(semantic.summarizeFromVideo as ReturnType<typeof vi.fn>).mockResolvedValue('')

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
        ocrText: '',
      })
      expect(embedder.embed).toHaveBeenCalledWith('A summary of the activity')
      expect(log.warn).toHaveBeenCalled()
    })

    it('falls back to empty OCR text for embedding when OCR and summary both fail soft', async () => {
      const { stitcher, ocr, semantic, embedder } = makeDeps()
      ;(ocr.extractText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ocr failed'))
      ;(semantic.summarizeFromVideo as ReturnType<typeof vi.fn>).mockResolvedValue('')

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
