import { type ChildProcess, spawn } from 'child_process'
import * as fs from 'fs'
import * as readline from 'readline'
import log from '../../logger'
import {
  buildMacCommandPayload,
  buildMacSpawnArgs,
  getExecutable as getMacExecutable,
} from './native-screenshot-mac'
import {
  buildWindowsCommandPayload,
  buildWindowsSpawnArgs,
  getExecutable as getWindowsExecutable,
} from './native-screenshot-win'

// MARK: - Push-based backend interface

export interface CapturedFrame {
  filepath: string
  timestamp: number
  width: number
  height: number
  displayId: number
}

export interface CaptureBackendConfig {
  outputDir: string
  intervalMs?: number
  maxDimensionPx?: number
  onFrame: (frame: CapturedFrame) => void
}

export interface ScreenshotExecutable {
  readonly command: string
  readonly args: readonly string[]
}

export type CaptureBackendCommand = {
  displayId?: number | null // null = reset to main display
  intervalMs?: number
}

export interface ScreenshotPlatformAdapter {
  getExecutable(): ScreenshotExecutable
  buildSpawnArgs(config: CaptureBackendConfig): string[]
  buildCommandPayload(command: CaptureBackendCommand): Record<string, unknown>
}

export interface ScreenCaptureBackend {
  start(config: CaptureBackendConfig): Promise<void>
  stop(): Promise<void>
  send(command: CaptureBackendCommand): void
}

const PLATFORM_SCREEN_CAPTURE_BACKENDS: Partial<
  Record<NodeJS.Platform, () => ScreenCaptureBackend>
> = {
  darwin: () =>
    new ScreenshotDaemon({
      getExecutable: getMacExecutable,
      buildSpawnArgs: buildMacSpawnArgs,
      buildCommandPayload: buildMacCommandPayload,
    }),
  win32: () =>
    new ScreenshotDaemon({
      getExecutable: getWindowsExecutable,
      buildSpawnArgs: buildWindowsSpawnArgs,
      buildCommandPayload: buildWindowsCommandPayload,
    }),
}

export function createScreenCaptureBackend(): ScreenCaptureBackend {
  const factory = PLATFORM_SCREEN_CAPTURE_BACKENDS[process.platform]
  if (!factory) {
    throw new Error(`Screen capture is not supported on platform "${process.platform}"`)
  }
  return factory()
}

// MARK: - ScreenshotDaemon (autonomous push-based SCK daemon)

const DAEMON_MAX_RESTARTS = 5
const DAEMON_RESTART_BACKOFF_MS = 1_000

export class ScreenshotDaemon implements ScreenCaptureBackend {
  constructor(private readonly adapter?: ScreenshotPlatformAdapter) {}

  private process: ChildProcess | null = null
  private rl: readline.Interface | null = null
  private restartCount = 0
  private started = false
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private config: CaptureBackendConfig | null = null

  async start(config: CaptureBackendConfig): Promise<void> {
    if (this.started) return
    this.config = config
    fs.mkdirSync(config.outputDir, { recursive: true })
    this.started = true
    this.restartCount = 0
    await this.spawnDaemon()
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    this.config = null
    this.cancelScheduledRestart()
    this.killProcess()
  }

  send(command: CaptureBackendCommand): void {
    if (!this.started || !this.process?.stdin?.writable) {
      log.warn('[ScreenshotDaemon] Cannot send command: daemon not running')
      return
    }

    const payload = this.getAdapter().buildCommandPayload(command)

    this.process.stdin.write(JSON.stringify(payload) + '\n')
  }

  private async spawnDaemon(): Promise<void> {
    const adapter = this.getAdapter()
    const { command, args } = adapter.getExecutable()
    const config = this.config!
    const daemonArgs = [...args, ...adapter.buildSpawnArgs(config)]

    log.info('[ScreenshotDaemon] Spawning daemon process')
    const proc = spawn(command, daemonArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.process = proc

    const rl = readline.createInterface({ input: proc.stdout! })
    this.rl = rl

    rl.on('line', (line) => {
      this.handleLine(line)
    })

    proc.stderr?.on('data', (chunk) => {
      const msg = chunk.toString().trim()
      if (msg) {
        log.warn(`[ScreenshotDaemon:stderr] ${msg}`)
      }
    })

    proc.on('error', (err) => {
      log.error('[ScreenshotDaemon] Process error:', err)
      this.handleProcessExit()
    })

    proc.on('close', (code) => {
      log.warn(`[ScreenshotDaemon] Process exited with code ${code}`)
      this.handleProcessExit()
    })
  }

  private handleLine(line: string): void {
    let parsed: CapturedFrame
    try {
      parsed = JSON.parse(line) as CapturedFrame
    } catch {
      log.warn(`[ScreenshotDaemon] Invalid JSON from daemon: ${line}`)
      return
    }

    if (!parsed.filepath || !parsed.timestamp) {
      log.warn(`[ScreenshotDaemon] Incomplete frame data: ${line}`)
      return
    }

    // Reset restart count on successful frame
    this.restartCount = 0

    this.config?.onFrame(parsed)
  }

  private handleProcessExit(): void {
    this.rl?.close()
    this.rl = null
    this.process = null

    if (!this.started) return

    if (this.restartCount >= DAEMON_MAX_RESTARTS) {
      log.error(`[ScreenshotDaemon] Max restarts (${DAEMON_MAX_RESTARTS}) reached, giving up`)
      this.started = false
      return
    }

    this.restartCount++
    const delay = DAEMON_RESTART_BACKOFF_MS * this.restartCount
    log.info(
      `[ScreenshotDaemon] Scheduling restart ${this.restartCount}/${DAEMON_MAX_RESTARTS} in ${delay}ms`,
    )

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.started) return
      this.spawnDaemon().catch((err) => {
        log.error('[ScreenshotDaemon] Restart failed:', err)
      })
    }, delay)
  }

  private cancelScheduledRestart(): void {
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
  }

  private killProcess(): void {
    if (this.process) {
      try {
        this.process.stdin?.end()
        this.process.kill('SIGTERM')
      } catch {
        // best-effort
      }
      this.process = null
    }
    this.rl?.close()
    this.rl = null
  }

  private getAdapter(): ScreenshotPlatformAdapter {
    if (this.adapter) {
      return this.adapter
    }

    const factory = PLATFORM_SCREEN_CAPTURE_BACKENDS[process.platform]
    if (!factory) {
      throw new Error(`Screen capture is not supported on platform "${process.platform}"`)
    }

    const backend = factory()
    if (!(backend instanceof ScreenshotDaemon) || !backend.adapter) {
      throw new Error(`Platform "${process.platform}" does not provide a screenshot adapter`)
    }

    return backend.adapter
  }
}
