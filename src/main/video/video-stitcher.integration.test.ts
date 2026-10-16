import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { FfmpegVideoStitcher } from './video-stitcher'

const RUN_INTEGRATION = process.env.RUN_VIDEO_STITCHER_INTEGRATION === '1'
const describeIntegration = RUN_INTEGRATION ? describe.sequential : describe.skip

const OUTPUT_ROOT_DIR = path.resolve(process.cwd(), '.debug-video-stitcher')
const RUN_OUTPUT_DIR = path.join(OUTPUT_ROOT_DIR, new Date().toISOString().replace(/[:.]/g, '-'))

async function createFrame(
  filepath: string,
  rgb: { r: number; g: number; b: number },
  size = { width: 640, height: 360 },
): Promise<void> {
  await sharp({
    create: {
      width: size.width,
      height: size.height,
      channels: 3,
      background: rgb,
    },
  })
    .png()
    .toFile(filepath)
}

describeIntegration('video stitcher integration', () => {
  beforeAll(() => {
    fs.mkdirSync(RUN_OUTPUT_DIR, { recursive: true })
  })

  it('stitches generated png frames into an mp4 file', async () => {
    const frameDir = path.join(RUN_OUTPUT_DIR, 'frames')
    fs.mkdirSync(frameDir, { recursive: true })

    const framePaths = [
      path.join(frameDir, 'frame-01.png'),
      path.join(frameDir, 'frame-02.png'),
      path.join(frameDir, 'frame-03.png'),
    ]

    await createFrame(framePaths[0], { r: 220, g: 30, b: 40 })
    await createFrame(framePaths[1], { r: 40, g: 160, b: 60 })
    await createFrame(framePaths[2], { r: 30, g: 80, b: 210 })

    const outputPath = path.join(RUN_OUTPUT_DIR, 'stitched.mp4')
    const stitcher = new FfmpegVideoStitcher()
    const result = await stitcher.stitch({
      activityId: 'integration-activity-1',
      frames: [
        { filepath: framePaths[0], timestamp: 1_000 },
        { filepath: framePaths[1], timestamp: 2_000 },
        { filepath: framePaths[2], timestamp: 3_000 },
      ],
      outputPath,
    })

    expect(result.videoPath).toBe(path.resolve(outputPath))
    expect(result.frameCount).toBe(framePaths.length)
    expect(result.durationMs).toBe(3_000)
    expect(fs.existsSync(outputPath)).toBe(true)
    expect(fs.statSync(outputPath).size).toBeGreaterThan(0)
  }, 20_000)

  it('prints where the output video was saved for manual inspection', () => {
    expect(fs.existsSync(path.join(RUN_OUTPUT_DIR, 'stitched.mp4'))).toBe(true)
    console.log(`[VideoStitcherIntegration] Saved outputs in: ${RUN_OUTPUT_DIR}`)
  })

  it('can write output to a nested directory that does not yet exist', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'video-stitcher-integration-'))
    try {
      const frameA = path.join(tempRoot, 'a.png')
      const frameB = path.join(tempRoot, 'b.png')

      await createFrame(frameA, { r: 120, g: 20, b: 180 })
      await createFrame(frameB, { r: 20, g: 180, b: 140 })

      const nestedOutput = path.join(tempRoot, 'nested', 'path', 'video.mp4')
      const stitcher = new FfmpegVideoStitcher()
      const result = await stitcher.stitch({
        activityId: 'integration-activity-2',
        frames: [
          { filepath: frameA, timestamp: 1_000 },
          { filepath: frameB, timestamp: 2_000 },
        ],
        outputPath: nestedOutput,
      })

      expect(result.videoPath).toBe(path.resolve(nestedOutput))
      expect(fs.existsSync(nestedOutput)).toBe(true)
      expect(fs.statSync(nestedOutput).size).toBeGreaterThan(0)
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  }, 20_000)

  it('letterboxes mixed-size frames instead of stretching them', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'video-stitcher-integration-'))
    try {
      const laptop = path.join(tempRoot, 'laptop.png')
      const ultrawide = path.join(tempRoot, 'ultrawide.png')
      await createFrame(laptop, { r: 255, g: 255, b: 255 }, { width: 1728, height: 1118 })
      await createFrame(ultrawide, { r: 255, g: 255, b: 255 }, { width: 1920, height: 804 })

      const outputPath = path.join(tempRoot, 'mixed.mp4')
      await new FfmpegVideoStitcher().stitch({
        activityId: 'integration-activity-mixed',
        frames: [
          { filepath: laptop, timestamp: 1_000 },
          { filepath: ultrawide, timestamp: 2_000 },
        ],
        outputPath,
      })

      const lastFrame = path.join(tempRoot, 'last.png')
      execFileSync(ffmpegPath ?? 'ffmpeg', [
        '-loglevel',
        'error',
        '-ss',
        '1.5',
        '-i',
        outputPath,
        '-frames:v',
        '1',
        lastFrame,
      ])
      const { data, info } = await sharp(lastFrame).raw().toBuffer({ resolveWithObject: true })
      const luma = (x: number, y: number): number => data[(y * info.width + x) * info.channels]

      expect([info.width, info.height]).toEqual([1920, 1118])
      expect(luma(960, 20)).toBeLessThan(40)
      expect(luma(960, 559)).toBeGreaterThan(215)
      expect(luma(960, 1098)).toBeLessThan(40)
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  }, 20_000)
})
