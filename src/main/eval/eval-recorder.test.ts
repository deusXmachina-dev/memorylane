import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import sharp from 'sharp'
import { EvalRecorder, sanitizeFixtureName } from './eval-recorder'
import { InMemoryStream } from '@main/streams/in-memory-stream'
import type { Frame } from '@main/recorder/screen-capturer'
import type { EventWindow } from '@/shared/types'
import type { PipelineHarness } from '@main/activity/pipeline-harness'

vi.mock('@main/utils/logger', () => ({
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

const T0 = 1_700_000_000_000

let tmp: string
let fixturesRoot: string
let frameStream: InMemoryStream<Frame>
let eventStream: InMemoryStream<EventWindow>
let harness: PipelineHarness
let setRetain: (value: boolean) => void
let sweepNow: () => void
let startCapture: () => Promise<void>
let stopCapture: () => Promise<void>
let capturing: boolean

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-test-'))
  fixturesRoot = path.join(tmp, 'eval-fixtures')
  frameStream = new InMemoryStream<Frame>()
  eventStream = new InMemoryStream<EventWindow>()
  setRetain = vi.fn()
  sweepNow = vi.fn()
  startCapture = vi.fn(async () => {
    capturing = true
  })
  stopCapture = vi.fn(async () => {
    capturing = false
  })
  capturing = false

  const flush: () => void = vi.fn()
  const drainActivities: () => Promise<void> = vi.fn().mockResolvedValue(undefined)
  const waitForIdle: () => Promise<void> = vi.fn().mockResolvedValue(undefined)

  harness = {
    frameStream,
    eventStream,
    eventCapturer: { flush },
    drainActivities,
    setRetainScreenshots: setRetain,
    sweepNow,
    capturing: () => capturing,
    start: startCapture,
    stop: stopCapture,
    waitForIdle,
  } as PipelineHarness
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
    const recorder = new EvalRecorder({ harness, fixturesRoot })

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
    const recorder = new EvalRecorder({ harness, fixturesRoot })
    recorder.start('rec2')
    expect(startCapture).not.toHaveBeenCalled()

    await appendFrameAndWindow()
    await recorder.stop()
    expect(stopCapture).not.toHaveBeenCalled()
    // The extractor must still be drained even though we never stopped capture —
    // this is the race that previously left the final summaries unpersisted.
    expect(harness.drainActivities).toHaveBeenCalled()
  })

  it('cancels without writing a fixture', async () => {
    const recorder = new EvalRecorder({ harness, fixturesRoot })
    recorder.start('rec5')
    await appendFrameAndWindow()
    await recorder.cancel()

    expect(recorder.isRecording()).toBe(false)
    expect(stopCapture).toHaveBeenCalled()
    expect(setRetain).toHaveBeenLastCalledWith(false)
    expect(fs.existsSync(path.join(fixturesRoot, 'rec5'))).toBe(false)
    expect(fs.existsSync(path.join(fixturesRoot, '.staging', 'rec5'))).toBe(false)
  })

  it('rejects a second concurrent recording', () => {
    const recorder = new EvalRecorder({ harness, fixturesRoot })
    recorder.start('rec3')
    expect(() => recorder.start('rec4')).toThrow(/already in progress/)
  })

  it.each(['stop', 'cancel'] as const)('can record again after a failed %s', async (method) => {
    vi.mocked(harness.waitForIdle).mockRejectedValue(new Error('boom'))
    vi.mocked(harness.stop).mockRejectedValue(new Error('boom'))
    const recorder = new EvalRecorder({ harness, fixturesRoot })
    recorder.start('rec6')

    await expect(recorder[method]()).rejects.toThrow('boom')

    expect(recorder.isRecording()).toBe(false)
    expect(setRetain).toHaveBeenLastCalledWith(false)
    expect(() => recorder.start('rec7')).not.toThrow()
  })
})
