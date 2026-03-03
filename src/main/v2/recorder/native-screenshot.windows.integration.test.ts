import * as fs from 'fs'
import * as path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ScreenshotDaemon, type CapturedFrame } from './native-screenshot'

const RUN_INTEGRATION =
  process.platform === 'win32' && process.env.RUN_WINDOWS_NATIVE_SCREENSHOT_INTEGRATION === '1'
const describeIntegration = RUN_INTEGRATION ? describe.sequential : describe.skip

const OUTPUT_ROOT_DIR = path.resolve(process.cwd(), '.debug-native-screenshot-win')
const RUN_OUTPUT_DIR = path.join(OUTPUT_ROOT_DIR, new Date().toISOString().replace(/[:.]/g, '-'))
const FRAME_EVENT_LOG = path.join(RUN_OUTPUT_DIR, 'frame-events.jsonl')
const SUMMARY_PATH = path.join(RUN_OUTPUT_DIR, 'summary.json')

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])

function assertJpeg(pathname: string): void {
  expect(fs.existsSync(pathname)).toBe(true)
  const bytes = fs.readFileSync(pathname)
  expect(bytes.length).toBeGreaterThan(JPEG_SIGNATURE.length)
  expect(bytes.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)).toBe(true)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ensureElectronReady(): Promise<number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app, screen } = require('electron')
    if (app?.whenReady && screen?.getPrimaryDisplay) {
      await app.whenReady()
      return screen.getPrimaryDisplay().id
    }
  } catch {
    // Running under ELECTRON_RUN_AS_NODE without main-process screen APIs.
  }

  return 0
}

describeIntegration('native screenshot daemon integration on Windows', () => {
  let daemon: ScreenshotDaemon | null = null
  const receivedFrames: CapturedFrame[] = []
  let primaryDisplayId = 0

  beforeAll(async () => {
    primaryDisplayId = await ensureElectronReady()
    fs.mkdirSync(RUN_OUTPUT_DIR, { recursive: true })

    daemon = new ScreenshotDaemon()
    await daemon.start({
      outputDir: RUN_OUTPUT_DIR,
      intervalMs: 500,
      maxDimensionPx: 1600,
      onFrame: (frame) => {
        receivedFrames.push(frame)
        fs.appendFileSync(FRAME_EVENT_LOG, JSON.stringify(frame) + '\n')
      },
    })

    if (primaryDisplayId > 0) {
      daemon.send({ displayId: primaryDisplayId })
    }
  })

  afterAll(async () => {
    if (daemon) {
      await daemon.stop()
    }

    const summary = {
      frameCount: receivedFrames.length,
      firstTimestamp: receivedFrames[0]?.timestamp ?? null,
      lastTimestamp: receivedFrames[receivedFrames.length - 1]?.timestamp ?? null,
      displayIds: [...new Set(receivedFrames.map((frame) => frame.displayId))],
    }
    fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2))
    delete process.env.MEMORYLANE_SCREENSHOT_WIN_EXECUTABLE
  })

  it('captures frames and writes inspectable artifacts', async () => {
    const startCount = receivedFrames.length
    await sleep(2200)

    const newFrames = receivedFrames.slice(startCount)
    expect(newFrames.length).toBeGreaterThanOrEqual(2)

    for (const frame of newFrames) {
      expect(frame.filepath).toBeTruthy()
      expect(frame.timestamp).toBeGreaterThan(0)
      expect(frame.width).toBeGreaterThan(0)
      expect(frame.height).toBeGreaterThan(0)
      expect(frame.displayId).toBeGreaterThanOrEqual(0)
      if (primaryDisplayId > 0) {
        expect(frame.displayId).toBe(primaryDisplayId)
      }
      expect(Math.max(frame.width, frame.height)).toBeLessThanOrEqual(1600)
      assertJpeg(frame.filepath)
    }
  }, 15_000)

  it('keeps capturing after sending the same display id again', async () => {
    expect(receivedFrames.length).toBeGreaterThan(0)

    daemon?.send({ displayId: primaryDisplayId })
    const frameCountBefore = receivedFrames.length
    await sleep(1500)

    expect(receivedFrames.length).toBeGreaterThan(frameCountBefore)
    expect(receivedFrames[receivedFrames.length - 1].displayId).toBeGreaterThanOrEqual(0)
    if (primaryDisplayId > 0) {
      expect(receivedFrames[receivedFrames.length - 1].displayId).toBe(primaryDisplayId)
    }
  }, 10_000)

  it('prints the output directory for manual inspection', () => {
    console.log(`[NativeScreenshotWindowsIntegration] Saved captures in: ${RUN_OUTPUT_DIR}`)
  })
})
