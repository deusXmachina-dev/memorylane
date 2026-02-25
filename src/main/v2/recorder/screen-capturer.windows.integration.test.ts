import * as fs from 'fs'
import * as path from 'path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Frame, ScreenCapturer } from './screen-capturer'
import { InMemoryStream } from '../streams/in-memory-stream'
import type { StreamSubscription } from '../streams/stream'

const RUN_INTEGRATION = process.platform === 'win32' && process.env.RUN_WINDOWS_INTEGRATION === '1'
const describeIntegration = RUN_INTEGRATION ? describe.sequential : describe.skip

const SIDE_CAR_BINARY_PATH = path.resolve(
  process.cwd(),
  'build',
  'rust',
  'screenshot-capturer-windows.exe',
)
const OUTPUT_ROOT_DIR = path.resolve(process.cwd(), '.debug-native-screenshot-win')
const RUN_OUTPUT_DIR = path.join(OUTPUT_ROOT_DIR, new Date().toISOString().replace(/[:.]/g, '-'))

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function assertPng(pathname: string): void {
  expect(fs.existsSync(pathname)).toBe(true)
  const bytes = fs.readFileSync(pathname)
  expect(bytes.length).toBeGreaterThan(PNG_SIGNATURE.length)
  expect(bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)).toBe(true)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function flushAsyncAppends(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describeIntegration('screen capturer windows integration', () => {
  let capturer: ScreenCapturer | null = null
  const subscriptions: StreamSubscription[] = []

  beforeAll(() => {
    if (!fs.existsSync(SIDE_CAR_BINARY_PATH)) {
      throw new Error(
        `Missing screenshot sidecar binary at ${SIDE_CAR_BINARY_PATH}. Run "npm run build:rust" first.`,
      )
    }

    fs.mkdirSync(RUN_OUTPUT_DIR, { recursive: true })
  })

  afterEach(() => {
    if (capturer) {
      capturer.stop()
      capturer = null
    }
    while (subscriptions.length > 0) {
      const sub = subscriptions.pop()
      sub?.unsubscribe()
    }
  })

  it('captures and appends frames through the Windows sidecar', async () => {
    const outputDir = path.join(RUN_OUTPUT_DIR, 'capture-test')
    const stream = new InMemoryStream<Frame>()
    const frames: Frame[] = []

    capturer = new ScreenCapturer({
      intervalMs: 1000,
      outputDir,
      stream,
    })
    subscriptions.push(
      stream.subscribe({
        startAt: { type: 'now' },
        onRecord: (record) => frames.push(record.payload),
      }),
    )

    capturer.start()
    await sleep(3500)
    capturer.stop()
    await flushAsyncAppends()

    expect(frames.length).toBeGreaterThanOrEqual(2)
    for (let index = 0; index < frames.length; index += 1) {
      const frame = frames[index]
      expect(frame.sequenceNumber).toBe(index)
      expect(frame.timestamp).toBeGreaterThan(0)
      expect(frame.displayId).toBeGreaterThanOrEqual(0)
      assertPng(frame.filepath)
    }
  }, 20_000)
})
