import { spawn, ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import * as fs from 'fs'
import * as path from 'path'
import { SCREEN_CAPTURER_SIDECAR_CONFIG } from '@constants'
import log from '../../logger'

const SCREENSHOT_CAPTURER_MAC_EXECUTABLE_ENV = 'MEMORYLANE_SCREENSHOT_CAPTURER_MAC_EXECUTABLE'

interface SidecarExecutable {
  readonly command: string
  readonly args: readonly string[]
}

interface StartOptions {
  readonly outputDir: string
  readonly intervalMs: number
  readonly onFrame: (frame: MacSidecarFrame) => void
  readonly onError: (error: string) => void
}

interface ReadyEvent {
  readonly type: 'ready'
  readonly timestamp: number
}

interface DisplayChangeEvent {
  readonly type: 'display_change'
  readonly timestamp: number
  readonly displayId: number
}

interface ScreenshotSavedEvent {
  readonly type: 'screenshot_saved'
  readonly timestamp: number
  readonly displayId: number
  readonly filepath: string
  readonly width: number
  readonly height: number
}

interface ErrorEvent {
  readonly type: 'error'
  readonly timestamp: number
  readonly error: string
}

type SidecarEvent = ReadyEvent | DisplayChangeEvent | ScreenshotSavedEvent | ErrorEvent

export interface MacSidecarFrame {
  readonly timestamp: number
  readonly displayId: number
  readonly filepath: string
  readonly width: number
  readonly height: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSidecarEvent(value: unknown): value is SidecarEvent {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.timestamp !== 'number') {
    return false
  }

  if (value.type === 'ready') {
    return true
  }
  if (value.type === 'display_change') {
    return typeof value.displayId === 'number'
  }
  if (value.type === 'screenshot_saved') {
    return (
      typeof value.displayId === 'number' &&
      typeof value.filepath === 'string' &&
      typeof value.width === 'number' &&
      typeof value.height === 'number'
    )
  }
  if (value.type === 'error') {
    return typeof value.error === 'string'
  }
  return false
}

function getExecutable(): SidecarExecutable {
  const overridePath = process.env[SCREENSHOT_CAPTURER_MAC_EXECUTABLE_ENV]
  if (overridePath) {
    if (fs.existsSync(overridePath)) {
      return { command: overridePath, args: [] }
    }
    throw new Error(`mac screenshot sidecar override binary not found at ${overridePath}`)
  }

  let isPackaged = false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    isPackaged = require('electron').app.isPackaged
  } catch {
    // Running under ELECTRON_RUN_AS_NODE — treat as dev
  }

  if (isPackaged) {
    const packagedBinaryPath = path.join(process.resourcesPath, 'rust', 'screenshot-capturer-mac')
    if (fs.existsSync(packagedBinaryPath)) {
      return { command: packagedBinaryPath, args: [] }
    }
    throw new Error(`mac screenshot sidecar binary not found at ${packagedBinaryPath}`)
  }

  const devBinaryPath = path.resolve(process.cwd(), 'build', 'rust', 'screenshot-capturer-mac')
  if (fs.existsSync(devBinaryPath)) {
    return { command: devBinaryPath, args: [] }
  }

  throw new Error(
    `mac screenshot sidecar binary not found at ${devBinaryPath}. Run "npm run build:rust" first.`,
  )
}

export class MacScreenCapturerSidecar {
  private proc: ChildProcess | null = null
  private retries = 0
  private stopped = false
  private options: StartOptions | null = null

  start(options: StartOptions): void {
    if (this.proc) {
      log.info('[ScreenCapturer:mac-sidecar] Already running, skipping start')
      return
    }

    this.options = options
    this.retries = 0
    this.stopped = false
    this.spawn()
  }

  stop(): void {
    this.stopped = true
    this.options = null

    if (this.proc) {
      log.info(`[ScreenCapturer:mac-sidecar] Stopping (pid=${this.proc.pid})`)
      this.proc.kill('SIGTERM')
      this.proc = null
    }
  }

  isRunning(): boolean {
    return this.proc !== null && !this.proc.killed
  }

  setDisplayId(displayId: number | undefined): void {
    void displayId
    // The sidecar tracks the focused display itself.
  }

  private scheduleRestartOrFatalError(message: string): void {
    const options = this.options
    if (!options) {
      return
    }

    if (this.retries < SCREEN_CAPTURER_SIDECAR_CONFIG.MAX_RESTART_RETRIES) {
      this.retries += 1
      const delay = SCREEN_CAPTURER_SIDECAR_CONFIG.RESTART_BACKOFF_MS * this.retries
      log.info(
        `[ScreenCapturer:mac-sidecar] Restarting in ${delay}ms (attempt ${this.retries}/${SCREEN_CAPTURER_SIDECAR_CONFIG.MAX_RESTART_RETRIES})`,
      )
      setTimeout(() => this.spawn(), delay)
      return
    }

    options.onError(message)
  }

  private spawn(): void {
    if (this.stopped || !this.options) {
      return
    }

    let executable: SidecarExecutable
    try {
      executable = getExecutable()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn(`[ScreenCapturer:mac-sidecar] ${message}`)
      this.options.onError(message)
      return
    }

    const args = [
      ...executable.args,
      '--output-dir',
      this.options.outputDir,
      '--interval-ms',
      String(this.options.intervalMs),
    ]
    log.info(`[ScreenCapturer:mac-sidecar] Spawning: ${executable.command} ${args.join(' ')}`)
    const child = spawn(executable.command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.proc = child

    const rl = createInterface({ input: child.stdout! })
    rl.on('line', (line) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        log.warn(`[ScreenCapturer:mac-sidecar] Could not parse line: ${line}`)
        return
      }

      if (!isSidecarEvent(parsed)) {
        log.warn(`[ScreenCapturer:mac-sidecar] Ignoring unexpected event shape: ${line}`)
        return
      }

      if (parsed.type === 'ready') {
        this.retries = 0
        log.info('[ScreenCapturer:mac-sidecar] Ready event received')
        return
      }

      if (parsed.type === 'display_change') {
        log.debug(`[ScreenCapturer:mac-sidecar] Active display changed: ${parsed.displayId}`)
        return
      }

      if (parsed.type === 'error') {
        this.options?.onError(parsed.error)
        return
      }

      this.options?.onFrame({
        timestamp: parsed.timestamp,
        displayId: parsed.displayId,
        filepath: parsed.filepath,
        width: parsed.width,
        height: parsed.height,
      })
    })

    child.stderr?.on('data', (data) => {
      const message = Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
      log.warn(`[ScreenCapturer:mac-sidecar] stderr: ${message.trim()}`)
    })

    child.on('error', (error) => {
      this.options?.onError(error.message)
    })

    child.on('close', (code, signal) => {
      this.proc = null
      log.info(
        `[ScreenCapturer:mac-sidecar] Process exited (code=${code}, signal=${signal}, stopped=${this.stopped})`,
      )
      if (this.stopped) {
        return
      }

      const message = `mac screenshot sidecar exited unexpectedly (code=${code}, signal=${signal})`
      this.scheduleRestartOrFatalError(message)
    })
  }
}
