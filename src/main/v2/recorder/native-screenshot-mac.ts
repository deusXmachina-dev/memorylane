import * as fs from 'fs'
import * as path from 'path'
import type {
  CaptureBackendCommand,
  CaptureBackendConfig,
  ScreenshotExecutable,
} from './native-screenshot'

const SCREENSHOT_EXECUTABLE_ENV = 'MEMORYLANE_SCREENSHOT_EXECUTABLE'

export function getExecutable(): ScreenshotExecutable {
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

export function buildMacSpawnArgs(config: CaptureBackendConfig): string[] {
  const daemonArgs = [
    '--outputDir',
    config.outputDir,
    '--intervalMs',
    String(config.intervalMs ?? 1000),
    '--format',
    'jpeg',
    '--quality',
    '80',
  ]

  if (config.maxDimensionPx !== undefined) {
    daemonArgs.push('--maxDimension', String(config.maxDimensionPx))
  }

  return daemonArgs
}

export function buildMacCommandPayload(command: CaptureBackendCommand): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (command.displayId !== undefined) {
    payload.displayId = command.displayId
  }
  if (command.intervalMs !== undefined) {
    payload.intervalMs = command.intervalMs
  }
  return payload
}
