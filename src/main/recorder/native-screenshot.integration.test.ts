import { ChildProcessByStdio, spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { Readable } from 'stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { captureDesktop, captureWindow } from './native-screenshot'

const RUN_INTEGRATION =
  process.platform === 'darwin' && process.env.RUN_NATIVE_SCREENSHOT_INTEGRATION === '1'
const describeIntegration = RUN_INTEGRATION ? describe.sequential : describe.skip

const SCREENSHOT_BINARY_PATH = path.resolve(process.cwd(), 'build', 'swift', 'screenshot')
const WINDOW_HOST_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'src',
  'main',
  'recorder',
  'swift',
  'integration-window-host.swift',
)
const OUTPUT_ROOT_DIR = path.resolve(process.cwd(), '.debug-native-screenshot')
const RUN_OUTPUT_DIR = path.join(OUTPUT_ROOT_DIR, new Date().toISOString().replace(/[:.]/g, '-'))

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
type WindowHostProcess = ChildProcessByStdio<null, Readable, Readable>

let previousExecutableOverride: string | undefined

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function assertPng(pathname: string): void {
  expect(fs.existsSync(pathname)).toBe(true)
  const bytes = fs.readFileSync(pathname)
  expect(bytes.length).toBeGreaterThan(PNG_SIGNATURE.length)
  expect(bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)).toBe(true)
}

async function waitForReadyLine(
  proc: WindowHostProcess,
  expectedLine: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    const timeout = setTimeout(() => {
      cleanup()
      reject(
        new Error(
          `Window host did not become ready within ${timeoutMs}ms.\nstdout=${stdout}\nstderr=${stderr}`,
        ),
      )
    }, timeoutMs)

    const onStdoutData = (chunk: Buffer | string): void => {
      stdout += chunk.toString()
      if (stdout.includes(expectedLine)) {
        cleanup()
        resolve()
      }
    }

    const onStderrData = (chunk: Buffer | string): void => {
      stderr += chunk.toString()
    }

    const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup()
      reject(
        new Error(
          `Window host exited before ready (code=${String(code)}, signal=${String(signal)}).\nstdout=${stdout}\nstderr=${stderr}`,
        ),
      )
    }

    const cleanup = (): void => {
      clearTimeout(timeout)
      proc.stdout.off('data', onStdoutData)
      proc.stderr.off('data', onStderrData)
      proc.off('close', onClose)
    }

    proc.stdout.on('data', onStdoutData)
    proc.stderr.on('data', onStderrData)
    proc.on('close', onClose)
  })
}

async function stopHost(proc: WindowHostProcess): Promise<void> {
  if (proc.killed) {
    return
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      proc.kill('SIGKILL')
      resolve()
    }, 1_000)

    proc.once('close', () => {
      clearTimeout(timeout)
      resolve()
    })

    proc.kill('SIGTERM')
  })
}

describeIntegration('native screenshot integration', () => {
  beforeAll(() => {
    if (!fs.existsSync(SCREENSHOT_BINARY_PATH)) {
      throw new Error(
        `Missing screenshot binary at ${SCREENSHOT_BINARY_PATH}. Run "npm run build:swift" first.`,
      )
    }

    if (!fs.existsSync(WINDOW_HOST_SCRIPT_PATH)) {
      throw new Error(`Missing window-host fixture at ${WINDOW_HOST_SCRIPT_PATH}.`)
    }

    fs.mkdirSync(RUN_OUTPUT_DIR, { recursive: true })
    previousExecutableOverride = process.env.MEMORYLANE_SCREENSHOT_EXECUTABLE
    process.env.MEMORYLANE_SCREENSHOT_EXECUTABLE = SCREENSHOT_BINARY_PATH
  })

  afterAll(() => {
    if (previousExecutableOverride === undefined) {
      delete process.env.MEMORYLANE_SCREENSHOT_EXECUTABLE
    } else {
      process.env.MEMORYLANE_SCREENSHOT_EXECUTABLE = previousExecutableOverride
    }
  })

  it('captures a real desktop screenshot using compiled swift binary', async () => {
    const outputPath = path.join(RUN_OUTPUT_DIR, 'desktop.png')
    const result = await captureDesktop({ outputPath })

    expect(result.filepath).toBe(outputPath)
    expect(result.width).toBeGreaterThan(0)
    expect(result.height).toBeGreaterThan(0)
    assertPng(outputPath)
  })

  it('captures a real window screenshot using compiled swift binary', async () => {
    const uniqueTitle = `MemoryLane Integration ${Date.now()}-${process.pid}`
    const host = spawn('swift', [WINDOW_HOST_SCRIPT_PATH, uniqueTitle, '20'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    try {
      await waitForReadyLine(host, `READY:${uniqueTitle}`, 10_000)
      await sleep(500)

      const outputPath = path.join(RUN_OUTPUT_DIR, 'window.png')

      let capture = await captureWindow({ outputPath, title: uniqueTitle })
      if (capture === null) {
        await sleep(500)
        capture = await captureWindow({ outputPath, title: uniqueTitle })
      }

      expect(capture).not.toBeNull()
      expect(capture?.filepath).toBe(outputPath)
      expect(capture?.width ?? 0).toBeGreaterThan(0)
      expect(capture?.height ?? 0).toBeGreaterThan(0)
      assertPng(outputPath)
    } finally {
      await stopHost(host)
    }
  })

  it('prints where screenshots were saved for manual inspection', () => {
    expect(fs.existsSync(path.join(RUN_OUTPUT_DIR, 'desktop.png'))).toBe(true)
    expect(fs.existsSync(path.join(RUN_OUTPUT_DIR, 'window.png'))).toBe(true)
    console.log(`[NativeScreenshotIntegration] Saved captures in: ${RUN_OUTPUT_DIR}`)
  })
})
