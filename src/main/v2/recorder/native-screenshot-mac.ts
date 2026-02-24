import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import type { DesktopCaptureBackend } from './native-screenshot-backend'

const SCREENSHOT_EXECUTABLE_ENV = 'MEMORYLANE_SCREENSHOT_EXECUTABLE'

interface ScreenshotExecutable {
  readonly command: string
  readonly args: readonly string[]
}

interface SwiftScreenCaptureSuccess {
  status: 'ok'
  mode: 'screen_only'
  filepath: string
  width: number
  height: number
  displayId: number
}

type SwiftCaptureOutput = SwiftScreenCaptureSuccess

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSwiftScreenCaptureSuccess(value: unknown): value is SwiftScreenCaptureSuccess {
  if (!isObjectRecord(value)) {
    return false
  }

  return (
    value.status === 'ok' &&
    value.mode === 'screen_only' &&
    typeof value.filepath === 'string' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    typeof value.displayId === 'number'
  )
}

function getExecutable(): ScreenshotExecutable {
  const overridePath = process.env[SCREENSHOT_EXECUTABLE_ENV]
  if (overridePath && overridePath.length > 0) {
    if (!fs.existsSync(overridePath)) {
      throw new Error(`screenshot executable override does not exist: ${overridePath}`)
    }
    return { command: overridePath, args: [] }
  }

  let isPackaged = false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    isPackaged = require('electron').app.isPackaged
  } catch {
    // Running under ELECTRON_RUN_AS_NODE — treat as dev
  }

  if (isPackaged) {
    const binaryPath = path.join(process.resourcesPath, 'swift', 'screenshot')
    if (fs.existsSync(binaryPath)) {
      return { command: binaryPath, args: [] }
    }
    throw new Error(`screenshot binary not found at ${binaryPath}`)
  }

  const devBinaryPath = path.resolve(process.cwd(), 'build', 'swift', 'screenshot')
  if (fs.existsSync(devBinaryPath)) {
    return { command: devBinaryPath, args: [] }
  }

  throw new Error(
    `screenshot binary not found at ${devBinaryPath}. Run "npm run build:swift" before starting capture.`,
  )
}

async function runCapture(args: string[]): Promise<SwiftCaptureOutput> {
  const { command, args: executableArgs } = getExecutable()

  return new Promise((resolve, reject) => {
    const proc = spawn(command, [...executableArgs, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timeoutMs = 10_000

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timeout = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
    }, timeoutMs)

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    proc.on('error', (error) => {
      clearTimeout(timeout)
      reject(new Error(`Failed to spawn screenshot process: ${error.message}`))
    })

    proc.on('close', (code) => {
      clearTimeout(timeout)

      if (timedOut) {
        reject(new Error(`Screenshot process timed out after ${timeoutMs}ms`))
        return
      }

      if (code !== 0) {
        const details = stderr.trim() || stdout.trim() || 'Unknown error'
        reject(new Error(`Screenshot process failed with code ${code}: ${details}`))
        return
      }

      const payload = stdout.trim()
      if (!payload) {
        reject(new Error('Screenshot process returned empty output'))
        return
      }

      try {
        const parsed = JSON.parse(payload) as unknown
        resolve(parsed as SwiftCaptureOutput)
      } catch {
        reject(new Error(`Screenshot process returned invalid JSON: ${payload}`))
      }
    })
  })
}

export const captureDesktopMacOS: DesktopCaptureBackend = async (options) => {
  const args = ['--output', options.outputPath]
  if (options.displayId !== undefined) {
    args.push('--display-id', String(options.displayId))
  }
  if (options.maxDimensionPx !== undefined) {
    if (!Number.isFinite(options.maxDimensionPx) || options.maxDimensionPx <= 0) {
      throw new Error(`maxDimensionPx must be a positive finite number: ${options.maxDimensionPx}`)
    }
    args.push('--max-dimension', String(Math.floor(options.maxDimensionPx)))
  }

  const output = await runCapture(args)
  if (!isSwiftScreenCaptureSuccess(output)) {
    throw new Error(`Unexpected screen capture response: ${JSON.stringify(output)}`)
  }

  return {
    filepath: output.filepath,
    width: output.width,
    height: output.height,
    displayId: output.displayId,
  }
}
