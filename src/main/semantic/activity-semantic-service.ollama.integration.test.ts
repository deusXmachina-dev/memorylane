import * as fs from 'fs'
import * as path from 'path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Activity, ActivityFrame } from '@main/activity/activity-types'
import { ActivitySemanticService, SemanticFileDebugDumper } from './activity-semantic-service'
import { InferenceProviderImpl } from '@main/llm/index'
import type { VendorCredentialsManager } from '@main/settings/vendor-credentials-manager'
import { FfmpegVideoStitcher } from '@main/video/video-stitcher'

const RUN_INTEGRATION = process.env.RUN_SEMANTIC_OLLAMA_INTEGRATION === '1'
const describeIntegration = RUN_INTEGRATION ? describe.sequential : describe.skip

const OLLAMA_BASE_URL = process.env.SEMANTIC_OLLAMA_BASE_URL ?? 'http://localhost:11434/v1'
const OLLAMA_MODEL = process.env.SEMANTIC_OLLAMA_MODEL ?? 'moondream:latest'
const OLLAMA_API_KEY = process.env.SEMANTIC_OLLAMA_API_KEY

const OUTPUT_ROOT_DIR = path.resolve(process.cwd(), '.debug-semantic-ollama')
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

function makeActivity(id: string, frames: ActivityFrame[]): Activity {
  const startTimestamp = frames[0]?.frame.timestamp ?? Date.now()
  const endTimestamp = frames[frames.length - 1]?.frame.timestamp ?? startTimestamp

  return {
    id,
    startTimestamp,
    endTimestamp,
    context: {
      appName: 'Google Chrome',
      bundleId: 'com.google.Chrome',
      windowTitle: 'MemoryLane Ollama fallback test',
      tld: 'example.com',
      url: 'https://example.com',
      displayId: 1,
    },
    interactions: [
      {
        type: 'app_change',
        timestamp: startTimestamp,
        activeWindow: {
          title: 'MemoryLane Ollama fallback test',
          processName: 'Google Chrome',
          bundleId: 'com.google.Chrome',
          url: 'https://example.com',
        },
      },
      {
        type: 'scroll',
        timestamp: startTimestamp + 15_000,
      },
    ],
    frames,
    provenance: {
      eventWindowOffsets: [0],
      frameOffsets: frames.map((frame) => frame.offset),
      sourceWindowIds: ['ollama-test-window'],
      sourceClosedBy: ['flush'],
    },
  }
}

describeIntegration('semantic service ollama custom endpoint integration', () => {
  beforeAll(() => {
    fs.mkdirSync(RUN_OUTPUT_DIR, { recursive: true })
  })

  it('falls back from video to snapshots and skips video on second run for image-only models', async () => {
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
      activityId: 'ollama-custom-endpoint-1',
      frames: frames.map((entry) => ({
        filepath: entry.frame.filepath,
        timestamp: entry.frame.timestamp,
      })),
      outputPath: videoPath,
    })

    const debugDumper = new SemanticFileDebugDumper({
      rootDir: path.join(RUN_OUTPUT_DIR, 'llm-round-trips'),
      copyMediaAssets: true,
    })

    const getCredentials: VendorCredentialsManager['getCredentials'] = () => ({
      apiKey: OLLAMA_API_KEY ?? '',
      baseURL: OLLAMA_BASE_URL,
    })
    const provider = new InferenceProviderImpl({
      credentials: { getCredentials } as VendorCredentialsManager,
      getActiveVendor: () => 'openai-compatible',
    })
    const service = new ActivitySemanticService(provider, {
      usageTracker: { recordUsage: () => undefined },
      debugDumper,
      requestTimeoutMs: 120_000,
      videoModels: [OLLAMA_MODEL],
      snapshotModels: [OLLAMA_MODEL],
    })

    const { summary: firstSummary } = await service.summarizeFromVideo({
      activity: makeActivity('ollama-custom-endpoint-1', frames),
      videoPath,
    })
    const firstDiagnostics = service.getLastRunDiagnostics()

    const { summary: secondSummary } = await service.summarizeFromVideo({
      activity: makeActivity('ollama-custom-endpoint-2', frames),
      videoPath,
    })
    const secondDiagnostics = service.getLastRunDiagnostics()

    fs.writeFileSync(
      path.join(RUN_OUTPUT_DIR, 'ollama-config.json'),
      JSON.stringify(
        {
          serverURL: OLLAMA_BASE_URL,
          model: OLLAMA_MODEL,
          hasApiKey: Boolean(OLLAMA_API_KEY),
        },
        null,
        2,
      ),
      'utf8',
    )
    fs.writeFileSync(
      path.join(RUN_OUTPUT_DIR, 'first-run-diagnostics.json'),
      JSON.stringify(firstDiagnostics, null, 2),
      'utf8',
    )
    fs.writeFileSync(
      path.join(RUN_OUTPUT_DIR, 'second-run-diagnostics.json'),
      JSON.stringify(secondDiagnostics, null, 2),
      'utf8',
    )
    fs.writeFileSync(path.join(RUN_OUTPUT_DIR, 'first-summary.txt'), firstSummary, 'utf8')
    fs.writeFileSync(path.join(RUN_OUTPUT_DIR, 'second-summary.txt'), secondSummary, 'utf8')

    expect(secondSummary.trim().length).toBeGreaterThan(0)

    expect(firstDiagnostics?.attempts.some((attempt) => attempt.mode === 'video')).toBe(true)
    expect(firstDiagnostics?.attempts.some((attempt) => attempt.mode === 'snapshot')).toBe(true)

    expect(secondDiagnostics?.chosenMode).toBe('snapshot')
    expect(secondDiagnostics?.chosenModel).toBe(OLLAMA_MODEL)
    expect(secondDiagnostics?.attempts.some((attempt) => attempt.mode === 'video')).toBe(false)
    expect(
      secondDiagnostics?.attempts.some((attempt) => attempt.mode === 'snapshot' && attempt.success),
    ).toBe(true)
    expect(secondDiagnostics?.fallbackReason).toBe('all video models marked unsupported (session)')
  }, 240_000)
})
