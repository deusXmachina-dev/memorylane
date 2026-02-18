import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { app } from 'electron'
import { ActivityClassificationInput } from '../../shared/types'
import { DebugPipelineWriter } from './debug-pipeline'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(),
  },
}))

vi.mock('../logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

describe('DebugPipelineWriter', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'memorylane-debug-pipeline-'))
    vi.mocked(app.getAppPath).mockReturnValue(tmpRoot)
    process.env.DEBUG_PIPELINE = '1'
  })

  afterEach(() => {
    delete process.env.DEBUG_PIPELINE
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('should dump video payloads and metadata fields', () => {
    const writer = DebugPipelineWriter.create()
    expect(writer).not.toBeNull()

    const input: ActivityClassificationInput = {
      activity: {
        id: 'activity-1',
        startTimestamp: 1_000,
        endTimestamp: 5_000,
        appName: 'VS Code',
        windowTitle: 'index.ts',
        screenshots: [],
        interactions: [],
      },
      screenshotPaths: [],
      videoPath: '/tmp/activity-1.mp4',
      previousSummaries: [],
    }

    writer!.dumpActivity(
      input,
      [
        { type: 'text', text: 'prompt body' },
        {
          type: 'video_url',
          videoUrl: {
            url: `data:video/mp4;base64,${Buffer.from('video-bytes').toString('base64')}`,
          },
        },
      ],
      {
        model: 'test-model',
        summary: 'summary',
        promptTokens: 10,
        completionTokens: 5,
        cost: 0.01,
        timestamp: Date.now(),
      },
    )

    const debugDir = path.join(tmpRoot, '.debug-pipeline')
    const [runDir] = fs.readdirSync(debugDir)
    const runPath = path.join(debugDir, runDir)

    expect(fs.existsSync(path.join(runPath, 'prompt.txt'))).toBe(true)
    expect(fs.existsSync(path.join(runPath, 'activity.mp4'))).toBe(true)
    expect(fs.existsSync(path.join(runPath, 'response.json'))).toBe(true)
    expect(fs.existsSync(path.join(runPath, 'activity.json'))).toBe(true)

    const activityJson = JSON.parse(
      fs.readFileSync(path.join(runPath, 'activity.json'), 'utf-8'),
    ) as {
      hasVideo: boolean
      videoCount: number
    }
    expect(activityJson.hasVideo).toBe(true)
    expect(activityJson.videoCount).toBe(1)
  })
})
