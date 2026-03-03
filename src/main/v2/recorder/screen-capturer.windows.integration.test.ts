import * as fs from 'fs'
import * as path from 'path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Frame, ScreenCapturer } from './screen-capturer'
import { InMemoryStream } from '../streams/in-memory-stream'
import type { StreamSubscription } from '../streams/stream'

const RUN_INTEGRATION =
  process.platform === 'win32' && process.env.RUN_WINDOWS_NATIVE_SCREENSHOT_INTEGRATION === '1'
const describeIntegration = RUN_INTEGRATION ? describe.sequential : describe.skip

const OUTPUT_ROOT_DIR = path.resolve(process.cwd(), '.debug-screen-capturer-win')
const RUN_OUTPUT_DIR = path.join(OUTPUT_ROOT_DIR, new Date().toISOString().replace(/[:.]/g, '-'))
const SUMMARY_PATH = path.join(RUN_OUTPUT_DIR, 'summary.json')

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function flushAsyncAppends(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function settleAfterStop(): Promise<void> {
  await sleep(700)
  await flushAsyncAppends()
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

describeIntegration('screen capturer integration on Windows', () => {
  let capturer: ScreenCapturer | null = null
  let subscriptions: StreamSubscription[] = []
  let primaryDisplayId = 0

  beforeAll(async () => {
    primaryDisplayId = await ensureElectronReady()
    fs.mkdirSync(RUN_OUTPUT_DIR, { recursive: true })
  })

  beforeEach(() => {
    subscriptions = []
  })

  afterEach(async () => {
    if (capturer) {
      await capturer.stop()
      capturer = null
    }
    for (const sub of subscriptions) {
      sub.unsubscribe()
    }
    subscriptions = []
  })

  afterAll(() => {
    delete process.env.MEMORYLANE_SCREENSHOT_WIN_EXECUTABLE
  })

  it('captures frames with stable sequence numbers on the selected display', async () => {
    const outputDir = path.join(RUN_OUTPUT_DIR, 'sequence-test')
    const stream = new InMemoryStream<Frame>()
    capturer = new ScreenCapturer({ intervalMs: 500, outputDir, stream, maxDimensionPx: 1400 })
    if (primaryDisplayId > 0) {
      capturer.setDisplayId(primaryDisplayId)
    }

    const frames: Frame[] = []
    subscriptions.push(
      stream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => frames.push(record.payload),
      }),
    )

    await capturer.start()
    await sleep(2600)
    await capturer.stop()
    await settleAfterStop()

    expect(frames.length).toBeGreaterThanOrEqual(3)
    for (let i = 0; i < frames.length; i++) {
      expect(frames[i].sequenceNumber).toBe(i)
      expect(frames[i].displayId).toBeGreaterThanOrEqual(0)
      if (primaryDisplayId > 0) {
        expect(frames[i].displayId).toBe(primaryDisplayId)
      }
      expect(fs.existsSync(frames[i].filepath)).toBe(true)
      expect(Math.max(frames[i].width, frames[i].height)).toBeLessThanOrEqual(1400)
    }

    fs.writeFileSync(
      SUMMARY_PATH,
      JSON.stringify(
        {
          frameCount: frames.length,
          firstSequence: frames[0]?.sequenceNumber ?? null,
          lastSequence: frames[frames.length - 1]?.sequenceNumber ?? null,
          displayIds: [...new Set(frames.map((frame) => frame.displayId))],
        },
        null,
        2,
      ),
    )
  }, 15_000)

  it('stop halts delivery', async () => {
    const outputDir = path.join(RUN_OUTPUT_DIR, 'stop-test')
    const stream = new InMemoryStream<Frame>()
    capturer = new ScreenCapturer({ intervalMs: 500, outputDir, stream })
    if (primaryDisplayId > 0) {
      capturer.setDisplayId(primaryDisplayId)
    }

    const frames: Frame[] = []
    subscriptions.push(
      stream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => frames.push(record.payload),
      }),
    )

    await capturer.start()
    await sleep(1500)
    await capturer.stop()
    await settleAfterStop()
    const countAfterStop = frames.length

    await sleep(1000)
    await flushAsyncAppends()

    expect(capturer.capturing).toBe(false)
    expect(frames.length).toBe(countAfterStop)
  }, 10_000)

  it('prints the output directory for manual inspection', () => {
    console.log(`[ScreenCapturerWindowsIntegration] Saved captures in: ${RUN_OUTPUT_DIR}`)
  })
})
