import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import sharp from 'sharp'
import { EvalRecorder, sanitizeFixtureName } from './eval-recorder'
import { InMemoryStream } from '../streams/in-memory-stream'
import type { Frame } from '../recorder/screen-capturer'
import type { EventWindow } from '../../shared/types'
import type { PipelineHarness } from '../pipeline-harness'
import type { RuntimeCaptureController } from '../capture-controller'
import type { StorageService } from '../storage'

vi.mock('../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Avoid ffmpeg: promoteCapture stitches a session.mp4 with video:true.
vi.mock('../video/video-stitcher', () => ({
  FfmpegVideoStitcher: class {
    async stitch(): Promise<{ videoPath: string; frameCount: number; durationMs: number }> {
      return { videoPath: 'mock.mp4', frameCount: 1, durationMs: 1000 }
    }
  },
}))

const storageStub = {
  activities: { getForDay: () => [] },
} as unknown as StorageService

const T0 = 1_700_000_000_000

let tmp: string
let fixturesRoot: string
let frameStream: InMemoryStream<Frame>
let eventStream: InMemoryStream<EventWindow>
let harness: PipelineHarness
let capture: RuntimeCaptureController
let setRetain: ReturnType<typeof vi.fn>
let sweepNow: ReturnType<typeof vi.fn>
let startCapture: ReturnType<typeof vi.fn>
let stopCapture: ReturnType<typeof vi.fn>
let capturing: boolean

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-test-'))
  fixturesRoot = path.join(tmp, 'eval-fixtures')
  frameStream = new InMemoryStream<Frame>()
  eventStream = new InMemoryStream<EventWindow>()
  setRetain = vi.fn()
  sweepNow = vi.fn()
  startCapture = vi.fn(() => {
    capturing = true
  })
  stopCapture = vi.fn(() => {
    capturing = false
  })
  capturing = false

  harness = {
    frameStream,
    eventStream,
    eventCapturer: { flush: vi.fn() },
    setRetainScreenshots: setRetain,
    sweepNow,
  } as unknown as PipelineHarness

  capture = {
    isCapturingNow: () => capturing,
    startCapture,
    stopCapture,
    waitForIdle: vi.fn().mockResolvedValue(undefined),
  } as unknown as RuntimeCaptureController
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

async function appendFrameAndWindow(): Promise<void> {
  const pngPath = path.join(tmp, 'live-frame.png')
  await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .png()
    .toFile(pngPath)
  await frameStream.append({
    filepath: pngPath,
    timestamp: T0,
    width: 64,
    height: 64,
    displayId: 1,
    sequenceNumber: 1,
  })
  await eventStream.append({
    id: 'w1',
    startTimestamp: T0,
    endTimestamp: T0 + 1000,
    events: [
      {
        type: 'app_change',
        timestamp: T0,
        activeWindow: { title: 'auth.ts', processName: 'Code' },
      },
    ],
    closedBy: 'gap',
  } as EventWindow)
}

describe('sanitizeFixtureName', () => {
  it('makes a filesystem-safe name', () => {
    expect(sanitizeFixtureName('My Session: 2026/06/15')).toBe('My-Session-2026-06-15')
    expect(sanitizeFixtureName('   ')).toBe('recording')
  })
})

describe('EvalRecorder', () => {
  it('holds retention, starts capture if off, and promotes on stop', async () => {
    const recorder = new EvalRecorder({ harness, capture, storage: storageStub, fixturesRoot })

    const status = recorder.start('rec1')
    expect(status.recording).toBe(true)
    expect(setRetain).toHaveBeenCalledWith(true)
    expect(startCapture).toHaveBeenCalled() // capture was off
    expect(recorder.isRecording()).toBe(true)

    await appendFrameAndWindow()

    const result = await recorder.stop()
    expect(result.frameCount).toBe(1)
    expect(result.eventWindowCount).toBe(1)

    // Retention released + reclaimed, capture restored to prior (off) state.
    expect(setRetain).toHaveBeenLastCalledWith(false)
    expect(sweepNow).toHaveBeenCalled()
    expect(stopCapture).toHaveBeenCalled()

    // Fixture written, staging cleaned up.
    expect(fs.existsSync(path.join(fixturesRoot, 'rec1', 'frames', 'live-frame.png'))).toBe(true)
    expect(fs.existsSync(path.join(fixturesRoot, '.staging', 'rec1'))).toBe(false)
    expect(recorder.isRecording()).toBe(false)
  })

  it('leaves capture running when it was already on', async () => {
    capturing = true
    const recorder = new EvalRecorder({ harness, capture, storage: storageStub, fixturesRoot })
    recorder.start('rec2')
    expect(startCapture).not.toHaveBeenCalled()

    await appendFrameAndWindow()
    await recorder.stop()
    expect(stopCapture).not.toHaveBeenCalled()
  })

  it('rejects a second concurrent recording', () => {
    const recorder = new EvalRecorder({ harness, capture, storage: storageStub, fixturesRoot })
    recorder.start('rec3')
    expect(() => recorder.start('rec4')).toThrow(/already in progress/)
  })
})
