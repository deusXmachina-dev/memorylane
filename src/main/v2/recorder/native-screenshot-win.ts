import * as fs from 'fs'
import * as path from 'path'
import type {
  CaptureBackendCommand,
  CaptureBackendConfig,
  ScreenshotExecutable,
} from './native-screenshot'

const SCREENSHOT_EXECUTABLE_ENV = 'MEMORYLANE_SCREENSHOT_WIN_EXECUTABLE'

export interface WindowsDisplayBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface WindowsDisplayTarget {
  readonly displayId: number
  readonly displayBounds: WindowsDisplayBounds
}

export interface ElectronDisplayLike {
  readonly id: number
  readonly bounds: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
}

export interface ElectronScreenLike {
  getAllDisplays(): ElectronDisplayLike[]
  getPrimaryDisplay(): ElectronDisplayLike
  dipToScreenRect(
    window: unknown,
    rect: ElectronDisplayLike['bounds'],
  ): ElectronDisplayLike['bounds']
}

function isFinitePositiveInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0
}

function normalizeDisplayBounds(
  bounds: ElectronDisplayLike['bounds'],
  screen: ElectronScreenLike,
): WindowsDisplayBounds | null {
  const physicalBounds = screen.dipToScreenRect(null, bounds)
  if (
    !Number.isFinite(physicalBounds.x) ||
    !Number.isFinite(physicalBounds.y) ||
    !isFinitePositiveInteger(physicalBounds.width) ||
    !isFinitePositiveInteger(physicalBounds.height)
  ) {
    return null
  }

  return {
    x: Math.trunc(physicalBounds.x),
    y: Math.trunc(physicalBounds.y),
    width: Math.trunc(physicalBounds.width),
    height: Math.trunc(physicalBounds.height),
  }
}

function getElectronScreen(): ElectronScreenLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron')
    return electron.screen ?? null
  } catch {
    return null
  }
}

export function resolveWindowsDisplayTarget(displayId: number | null): WindowsDisplayTarget | null {
  const screen = getElectronScreen()
  if (!screen) {
    return null
  }

  return resolveWindowsDisplayTargetFromScreen(screen, displayId)
}

export function resolveWindowsDisplayTargetFromScreen(
  screen: ElectronScreenLike,
  displayId: number | null,
): WindowsDisplayTarget | null {
  const display =
    displayId === null
      ? screen.getPrimaryDisplay()
      : screen.getAllDisplays().find((candidate) => candidate.id === displayId)
  if (!display) {
    return null
  }

  const displayBounds = normalizeDisplayBounds(display.bounds, screen)
  if (!displayBounds) {
    return null
  }

  return {
    displayId: display.id,
    displayBounds,
  }
}

function appendCommonSpawnArgs(args: string[], config: CaptureBackendConfig): void {
  args.push('--outputDir', config.outputDir)
  args.push('--intervalMs', String(config.intervalMs ?? 1000))
  args.push('--format', 'jpeg')
  args.push('--quality', '80')

  if (config.maxDimensionPx !== undefined) {
    args.push('--maxDimension', String(config.maxDimensionPx))
  }
}

function appendTargetArgs(args: string[], target: WindowsDisplayTarget): void {
  args.push('--displayId', String(target.displayId))
  args.push('--x', String(target.displayBounds.x))
  args.push('--y', String(target.displayBounds.y))
  args.push('--width', String(target.displayBounds.width))
  args.push('--height', String(target.displayBounds.height))
}

export function getExecutable(): ScreenshotExecutable {
  const overridePath = process.env[SCREENSHOT_EXECUTABLE_ENV]
  if (overridePath && overridePath.length > 0) {
    if (!fs.existsSync(overridePath)) {
      throw new Error(`Windows screenshot executable override does not exist: ${overridePath}`)
    }
    return { command: overridePath, args: [] }
  }

  let isPackaged = false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    isPackaged = require('electron').app.isPackaged
  } catch {
    // Running under ELECTRON_RUN_AS_NODE - treat as dev
  }

  if (isPackaged) {
    const binaryPath = path.join(process.resourcesPath, 'rust', 'screenshot-capturer-windows.exe')
    if (fs.existsSync(binaryPath)) {
      return { command: binaryPath, args: [] }
    }
    throw new Error(`Windows screenshot binary not found at ${binaryPath}`)
  }

  const devBinaryPath = path.resolve(
    process.cwd(),
    'build',
    'rust',
    'screenshot-capturer-windows.exe',
  )
  if (fs.existsSync(devBinaryPath)) {
    return { command: devBinaryPath, args: [] }
  }

  throw new Error(
    `Windows screenshot binary not found at ${devBinaryPath}. Run "npm run build:rust" before starting capture.`,
  )
}

export function buildWindowsSpawnArgs(config: CaptureBackendConfig): string[] {
  const args: string[] = []
  appendCommonSpawnArgs(args, config)

  const target = resolveWindowsDisplayTarget(null)
  if (target) {
    appendTargetArgs(args, target)
  }

  return args
}

export function buildWindowsCommandPayload(
  command: CaptureBackendCommand,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}

  if (command.intervalMs !== undefined) {
    payload.intervalMs = command.intervalMs
  }

  if (command.displayId === undefined) {
    return payload
  }

  const target = resolveWindowsDisplayTarget(command.displayId)
  if (target) {
    payload.displayId = target.displayId
    payload.displayBounds = target.displayBounds
    return payload
  }

  payload.displayId = command.displayId
  if (command.displayId === null) {
    payload.displayBounds = null
  }

  return payload
}
