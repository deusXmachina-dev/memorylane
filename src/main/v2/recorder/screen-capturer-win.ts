import { spawn, type ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import * as fs from 'fs'
import * as path from 'path'
import log from '../../logger'

const SCREENSHOT_EXECUTABLE_ENV = 'MEMORYLANE_SCREENSHOT_WIN_EXECUTABLE'
const MAX_RESTART_RETRIES = 3
const RESTART_BACKOFF_MS = 1000

interface BoundsPx {
  x: number
  y: number
  width: number
  height: number
}

interface StartCommand {
  type: 'start'
  outputDir: string
  intervalMs: number
  maxDimensionPx?: number
  displayId?: number
  targetBoundsPx?: BoundsPx
}

interface SetDisplayCommand {
  type: 'set_display'
  displayId?: number
  targetBoundsPx?: BoundsPx
}

interface StopCommand {
  type: 'stop'
}

type SidecarCommand = StartCommand | SetDisplayCommand | StopCommand

interface SidecarExecutable {
  readonly command: string
  readonly args: readonly string[]
}

interface SidecarReadyEvent {
  type: 'ready'
  timestamp: number
}

export interface ScreenCapturerWinFrameEvent {
  type: 'frame'
  timestamp: number
  filepath: string
  width: number
  height: number
  displayId: number
}

interface SidecarErrorEvent {
  type: 'error'
  timestamp: number
  error: string
}

export interface ScreenCapturerWinConfig {
  outputDir: string
  intervalMs: number
  maxDimensionPx?: number
  displayId?: number
}

export interface ScreenCapturerWin {
  start(config: ScreenCapturerWinConfig): void
  stop(): void
  setDisplayId(displayId: number | undefined): void
}

export interface CreateScreenCapturerWinParams {
  onFrame(event: ScreenCapturerWinFrameEvent): void
  onError(error: Error): void
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isScreenCapturerWinFrameEvent(
  value: unknown,
): value is ScreenCapturerWinFrameEvent {
  if (!isObjectRecord(value)) return false
  return (
    value.type === 'frame' &&
    isFiniteNumber(value.timestamp) &&
    typeof value.filepath === 'string' &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    isFiniteNumber(value.displayId)
  )
}

function isSidecarReadyEvent(value: unknown): value is SidecarReadyEvent {
  if (!isObjectRecord(value)) return false
  return value.type === 'ready' && isFiniteNumber(value.timestamp)
}

function isSidecarErrorEvent(value: unknown): value is SidecarErrorEvent {
  if (!isObjectRecord(value)) return false
  return (
    value.type === 'error' && isFiniteNumber(value.timestamp) && typeof value.error === 'string'
  )
}

function resolveDisplayBoundsPx(displayId: number | undefined): BoundsPx | undefined {
  if (displayId === undefined) {
    return undefined
  }

  let screen: Electron.Screen | undefined
  try {
    // Access electron lazily so unit tests and non-Electron contexts do not fail module load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as { screen?: Electron.Screen }
    screen = electron.screen
  } catch {
    return undefined
  }
  if (!screen) {
    return undefined
  }

  const displays = screen.getAllDisplays()
  const matched = displays.find((display) => display.id === displayId)
  if (!matched) {
    const available = displays.map((display) => display.id).join(', ')
    throw new Error(
      `[ScreenCapturer:win] Requested display ${displayId} not found. available=[${available}]`,
    )
  }

  const scaleFactor =
    Number.isFinite(matched.scaleFactor) && matched.scaleFactor > 0 ? matched.scaleFactor : 1

  return {
    x: Math.round(matched.bounds.x * scaleFactor),
    y: Math.round(matched.bounds.y * scaleFactor),
    width: Math.round(matched.bounds.width * scaleFactor),
    height: Math.round(matched.bounds.height * scaleFactor),
  }
}

function buildDisplayCommandPayload(displayId: number | undefined): {
  displayId?: number
  targetBoundsPx?: BoundsPx
} {
  if (displayId === undefined) {
    return {}
  }

  return {
    displayId,
    targetBoundsPx: resolveDisplayBoundsPx(displayId),
  }
}

function getExecutable(): SidecarExecutable {
  const overridePath = process.env[SCREENSHOT_EXECUTABLE_ENV]
  if (overridePath && overridePath.length > 0) {
    if (!fs.existsSync(overridePath)) {
      throw new Error(`Windows screenshot override binary not found at ${overridePath}`)
    }
    log.debug(`[ScreenCapturer:win] Using executable override: ${overridePath}`)
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
    const packagedBinaryPath = path.join(
      process.resourcesPath,
      'rust',
      'screenshot-capturer-windows.exe',
    )
    if (fs.existsSync(packagedBinaryPath)) {
      return { command: packagedBinaryPath, args: [] }
    }
    throw new Error(`Windows screenshot binary not found at ${packagedBinaryPath}`)
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

  throw new Error(`Windows screenshot binary not found at ${devBinaryPath}`)
}

export function isScreenCapturerWinSupported(): boolean {
  if (process.platform !== 'win32') {
    return false
  }

  try {
    getExecutable()
    return true
  } catch {
    return false
  }
}

export function createScreenCapturerWin(params: CreateScreenCapturerWinParams): ScreenCapturerWin {
  return new ScreenCapturerWinImpl(params)
}

class ScreenCapturerWinImpl implements ScreenCapturerWin {
  private readonly onFrame: (event: ScreenCapturerWinFrameEvent) => void
  private readonly onError: (error: Error) => void
  private proc: ChildProcess | null = null
  private retries = 0
  private stopped = true
  private started = false
  private config: ScreenCapturerWinConfig | null = null
  private restartTimer: ReturnType<typeof setTimeout> | null = null

  constructor(params: CreateScreenCapturerWinParams) {
    this.onFrame = params.onFrame
    this.onError = params.onError
  }

  start(config: ScreenCapturerWinConfig): void {
    if (this.started) {
      return
    }

    this.config = this.validateConfig(config)
    this.stopped = false
    this.started = true
    this.retries = 0
    this.clearRestartTimer()
    this.spawnSidecar()
  }

  stop(): void {
    this.stopped = true
    this.started = false
    this.clearRestartTimer()

    if (this.proc?.stdin && !this.proc.stdin.destroyed) {
      this.writeCommand({ type: 'stop' })
    }

    if (this.proc) {
      this.proc.kill('SIGTERM')
      this.proc = null
    }
  }

  setDisplayId(displayId: number | undefined): void {
    if (!this.config) {
      return
    }

    this.config = {
      ...this.config,
      displayId,
    }

    if (!this.proc || this.stopped) {
      return
    }

    this.sendDisplayUpdate()
  }

  private validateConfig(config: ScreenCapturerWinConfig): ScreenCapturerWinConfig {
    if (!Number.isFinite(config.intervalMs) || config.intervalMs <= 0) {
      throw new Error(`[ScreenCapturer:win] intervalMs must be > 0. Received: ${config.intervalMs}`)
    }
    if (
      config.maxDimensionPx !== undefined &&
      (!Number.isFinite(config.maxDimensionPx) || config.maxDimensionPx <= 0)
    ) {
      throw new Error(
        `[ScreenCapturer:win] maxDimensionPx must be a positive finite number. Received: ${config.maxDimensionPx}`,
      )
    }
    return {
      ...config,
      intervalMs: Math.floor(config.intervalMs),
      maxDimensionPx:
        config.maxDimensionPx === undefined ? undefined : Math.floor(config.maxDimensionPx),
    }
  }

  private spawnSidecar(): void {
    let executable: SidecarExecutable
    try {
      executable = getExecutable()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.emitError(new Error(message))
      return
    }

    const child = spawn(executable.command, [...executable.args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.proc = child
    log.info(`[ScreenCapturer:win] Spawned screenshot sidecar (pid=${child.pid})`)

    const rl = createInterface({ input: child.stdout! })
    rl.on('line', (line) => this.handleStdoutLine(line))

    child.stderr?.on('data', (chunk) => {
      const message = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      log.warn(`[ScreenCapturer:win] stderr: ${message.trim()}`)
    })

    child.on('error', (error) => {
      this.emitError(new Error(`[ScreenCapturer:win] Process error: ${error.message}`))
    })

    child.on('close', (code, signal) => {
      this.proc = null
      log.info(
        `[ScreenCapturer:win] Sidecar exited (code=${code}, signal=${signal}, stopped=${this.stopped})`,
      )
      if (this.stopped || !this.started) {
        return
      }
      this.scheduleRestart()
    })
  }

  private scheduleRestart(): void {
    if (this.retries >= MAX_RESTART_RETRIES) {
      this.emitError(
        new Error(
          `[ScreenCapturer:win] Sidecar crashed ${MAX_RESTART_RETRIES} times, not restarting`,
        ),
      )
      return
    }

    this.retries += 1
    const delayMs = RESTART_BACKOFF_MS * this.retries
    log.warn(
      `[ScreenCapturer:win] Restarting in ${delayMs}ms (attempt ${this.retries}/${MAX_RESTART_RETRIES})`,
    )
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawnSidecar()
    }, delayMs)
  }

  private clearRestartTimer(): void {
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
  }

  private handleStdoutLine(line: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      log.warn(`[ScreenCapturer:win] Could not parse line: ${line}`)
      return
    }

    if (isSidecarReadyEvent(parsed)) {
      this.retries = 0
      this.sendStartCommand()
      return
    }

    if (isScreenCapturerWinFrameEvent(parsed)) {
      this.onFrame(parsed)
      return
    }

    if (isSidecarErrorEvent(parsed)) {
      this.emitError(new Error(`[ScreenCapturer:win] ${parsed.error}`))
      return
    }

    log.warn(`[ScreenCapturer:win] Ignoring unexpected event shape: ${line}`)
  }

  private sendStartCommand(): void {
    if (!this.config) {
      this.emitError(
        new Error('[ScreenCapturer:win] Missing configuration while sending start command'),
      )
      return
    }

    try {
      const target = buildDisplayCommandPayload(this.config.displayId)
      const command: StartCommand = {
        type: 'start',
        outputDir: this.config.outputDir,
        intervalMs: this.config.intervalMs,
        maxDimensionPx: this.config.maxDimensionPx,
        ...target,
      }
      this.writeCommand(command)
    } catch (error) {
      const asError = error instanceof Error ? error : new Error(String(error))
      this.emitError(asError)
    }
  }

  private sendDisplayUpdate(): void {
    if (!this.config) return

    try {
      const target = buildDisplayCommandPayload(this.config.displayId)
      const command: SetDisplayCommand = {
        type: 'set_display',
        ...target,
      }
      this.writeCommand(command)
    } catch (error) {
      const asError = error instanceof Error ? error : new Error(String(error))
      this.emitError(asError)
    }
  }

  private writeCommand(command: SidecarCommand): void {
    if (!this.proc?.stdin || this.proc.stdin.destroyed) {
      return
    }
    this.proc.stdin.write(`${JSON.stringify(command)}\n`)
  }

  private emitError(error: Error): void {
    try {
      this.onError(error)
    } catch {
      // Callback errors are isolated so the capture backend remains alive.
    }
  }
}
