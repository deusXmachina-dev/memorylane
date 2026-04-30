import * as fs from 'fs'
import * as path from 'path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Activity, ActivityFrame } from './activity-types'
import { ActivitySemanticService, SemanticFileDebugDumper } from './activity-semantic-service'
import { InferenceProviderImpl } from './llm'
import { FfmpegVideoStitcher } from './video/video-stitcher'

const RUN_INTEGRATION =
  process.env.RUN_SEMANTIC_INTEGRATION === '1' &&
  typeof process.env.OPENROUTER_API_KEY === 'string' &&
  process.env.OPENROUTER_API_KEY.length > 0
const describeIntegration = RUN_INTEGRATION ? describe.sequential : describe.skip

const OUTPUT_ROOT_DIR = path.resolve(process.cwd(), '.debug-semantic')
const RUN_OUTPUT_DIR = path.join(OUTPUT_ROOT_DIR, new Date().toISOString().replace(/[:.]/g, '-'))

async function createFrame(
  filepath: string,
  rgb: { r: number; g: number; b: number },
): Promise<void> {
  await sharp({
    create: {
      width: 1280,
      height: 720,
      channels: 3,
      background: rgb,
    },
  })
    .png()
    .toFile(filepath)
}

function makeActivity(frames: ActivityFrame[]): Activity {
  const startTimestamp = frames[0]?.frame.timestamp ?? Date.now()
  const endTimestamp = frames[frames.length - 1]?.frame.timestamp ?? startTimestamp

  return {
    id: 'integration-semantic-1',
    startTimestamp,
    endTimestamp,
    context: {
      appName: 'Google Chrome',
      bundleId: 'com.google.Chrome',
      windowTitle: 'MemoryLane planning doc',
      tld: 'github.com',
      url: 'https://github.com/filip',
      displayId: 1,
    },
    interactions: [
      {
        type: 'app_change',
        timestamp: startTimestamp,
        activeWindow: {
          title: 'MemoryLane planning doc',
          processName: 'Google Chrome',
          bundleId: 'com.google.Chrome',
          url: 'https://github.com/filip',
        },
      },
      {
        type: 'keyboard',
        timestamp: startTimestamp + 12_000,
        keyCount: 42,
        durationMs: 8_000,
      },
      {
        type: 'scroll',
        timestamp: startTimestamp + 35_000,
      },
    ],
    frames,
    provenance: {
      eventWindowOffsets: [10],
      frameOffsets: frames.map((frame) => frame.offset),
      sourceWindowIds: ['integration-window'],
      sourceClosedBy: ['flush'],
    },
  }
}

describeIntegration('semantic service integration', () => {
  beforeAll(() => {
    fs.mkdirSync(RUN_OUTPUT_DIR, { recursive: true })
  })

  it('runs real model inference and dumps debug artifacts', async () => {
    const frameDir = path.join(RUN_OUTPUT_DIR, 'frames')
    fs.mkdirSync(frameDir, { recursive: true })

    const framePaths = [
      path.join(frameDir, 'frame-01.png'),
      path.join(frameDir, 'frame-02.png'),
      path.join(frameDir, 'frame-03.png'),
      path.join(frameDir, 'frame-04.png'),
    ]

    await createFrame(framePaths[0], { r: 240, g: 90, b: 60 })
    await createFrame(framePaths[1], { r: 60, g: 170, b: 95 })
    await createFrame(framePaths[2], { r: 55, g: 90, b: 210 })
    await createFrame(framePaths[3], { r: 180, g: 110, b: 210 })

    const frameTimestamps = [1_000, 21_000, 41_000, 61_000]
    const frames: ActivityFrame[] = framePaths.map((filepath, index) => ({
      offset: index,
      frame: {
        filepath,
        timestamp: frameTimestamps[index],
        width: 1280,
        height: 720,
        displayId: 1,
        sequenceNumber: index,
      },
    }))

    const videoPath = path.join(RUN_OUTPUT_DIR, 'activity.mp4')
    const stitcher = new FfmpegVideoStitcher()
    await stitcher.stitch({
      activityId: 'integration-semantic-1',
      frames: frames.map((entry) => ({
        filepath: entry.frame.filepath,
        timestamp: entry.frame.timestamp,
      })),
      outputPath: videoPath,
    })

    const activity = makeActivity(frames)
    const llmDumpRootDir = path.join(RUN_OUTPUT_DIR, 'llm-round-trips')
    const debugDumper = new SemanticFileDebugDumper({
      rootDir: llmDumpRootDir,
      copyMediaAssets: true,
    })
    const apiKey = process.env.OPENROUTER_API_KEY ?? ''
    const provider = new InferenceProviderImpl({
      credentials: {
        getCredentials: () => (apiKey ? { apiKey } : null),
      } as unknown as import('./settings/vendor-credentials-manager').VendorCredentialsManager,
      getActiveVendor: () => 'openrouter',
    })
    const service = new ActivitySemanticService(provider, {
      usageTracker: { recordUsage: () => undefined },
      debugDumper,
    })

    const startedAt = Date.now()
    const summary = await service.summarizeFromVideo({
      activity,
      videoPath,
    })
    const endedAt = Date.now()

    const diagnostics = service.getLastRunDiagnostics()

    fs.writeFileSync(
      path.join(RUN_OUTPUT_DIR, 'activity.json'),
      JSON.stringify(activity, null, 2),
      'utf8',
    )
    fs.writeFileSync(
      path.join(RUN_OUTPUT_DIR, 'request-metadata.json'),
      JSON.stringify(
        {
          startedAt,
          endedAt,
          elapsedMs: endedAt - startedAt,
          videoPath,
          runOutputDir: RUN_OUTPUT_DIR,
          llmDumpDir: debugDumper.getRunDir(),
        },
        null,
        2,
      ),
      'utf8',
    )
    fs.writeFileSync(
      path.join(RUN_OUTPUT_DIR, 'model-attempts.json'),
      JSON.stringify(diagnostics?.attempts ?? [], null, 2),
      'utf8',
    )
    fs.writeFileSync(
      path.join(RUN_OUTPUT_DIR, 'selected-snapshots.json'),
      JSON.stringify(diagnostics?.selectedSnapshotPaths ?? [], null, 2),
      'utf8',
    )
    fs.writeFileSync(path.join(RUN_OUTPUT_DIR, 'summary.txt'), summary, 'utf8')
    fs.writeFileSync(
      path.join(RUN_OUTPUT_DIR, 'timings.json'),
      JSON.stringify(
        {
          elapsedMs: endedAt - startedAt,
          chosenMode: diagnostics?.chosenMode ?? null,
          chosenModel: diagnostics?.chosenModel ?? null,
          fallbackReason: diagnostics?.fallbackReason ?? null,
        },
        null,
        2,
      ),
      'utf8',
    )

    expect(summary.trim().length).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(RUN_OUTPUT_DIR, 'activity.json'))).toBe(true)
    expect(fs.existsSync(path.join(RUN_OUTPUT_DIR, 'request-metadata.json'))).toBe(true)
    expect(fs.existsSync(path.join(RUN_OUTPUT_DIR, 'model-attempts.json'))).toBe(true)
    expect(fs.existsSync(path.join(RUN_OUTPUT_DIR, 'selected-snapshots.json'))).toBe(true)
    expect(fs.existsSync(path.join(RUN_OUTPUT_DIR, 'summary.txt'))).toBe(true)
    expect(fs.existsSync(path.join(RUN_OUTPUT_DIR, 'timings.json'))).toBe(true)
    expect(fs.existsSync(debugDumper.getRunDir())).toBe(true)
    expect(fs.readdirSync(debugDumper.getRunDir()).length).toBeGreaterThan(0)
    expect((diagnostics?.attempts.length ?? 0) > 0).toBe(true)
  }, 120_000)
})
