import { spawn, ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import * as path from 'path'
import * as fs from 'fs'
import { APP_WATCHER_CONFIG } from '@constants'
import { AppWatcherEvent } from './app-watcher'
import log from '../logger'

let proc: ChildProcess | null = null
let onEvent: ((event: AppWatcherEvent) => void) | null = null
let retries = 0
let stopped = false

interface AppWatcherExecutable {
  readonly command: string
  readonly args: readonly string[]
}

function isAppWatcherEvent(value: unknown): value is AppWatcherEvent {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const maybeType = Reflect.get(value, 'type')
  const maybeTimestamp = Reflect.get(value, 'timestamp')
  return (
    (maybeType === 'ready' ||
      maybeType === 'app_change' ||
      maybeType === 'window_change' ||
      maybeType === 'error') &&
    typeof maybeTimestamp === 'number'
  )
}

function getExecutable(): AppWatcherExecutable {
  const overridePath = process.env.MEMORYLANE_APP_WATCHER_WIN_EXECUTABLE
  if (overridePath) {
    if (fs.existsSync(overridePath)) {
      log.debug(`[AppWatcher:win] Using executable override: ${overridePath}`)
      return { command: overridePath, args: [] }
    }
    throw new Error(`App watcher override binary not found at ${overridePath}`)
  }

  let isPackaged = false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    isPackaged = require('electron').app.isPackaged
  } catch {
    // Running under ELECTRON_RUN_AS_NODE — treat as dev
  }

  if (isPackaged) {
    const packagedBinaryPath = path.join(process.resourcesPath, 'rust', 'app-watcher-windows.exe')
    if (fs.existsSync(packagedBinaryPath)) {
      return { command: packagedBinaryPath, args: [] }
    }
    throw new Error(`Windows app watcher binary not found at ${packagedBinaryPath}`)
  }

  const devBinaryPath = path.resolve(process.cwd(), 'build', 'rust', 'app-watcher-windows.exe')
  if (fs.existsSync(devBinaryPath)) {
    return { command: devBinaryPath, args: [] }
  }

  throw new Error(`Windows app watcher binary not found at ${devBinaryPath}`)
}

function scheduleRestartOrEmitFatalError(): void {
  if (retries < APP_WATCHER_CONFIG.MAX_RESTART_RETRIES) {
    retries++
    const delay = APP_WATCHER_CONFIG.RESTART_BACKOFF_MS * retries
    log.info(
      `[AppWatcher:win] Restarting in ${delay}ms (attempt ${retries}/${APP_WATCHER_CONFIG.MAX_RESTART_RETRIES})`,
    )
    setTimeout(spawnWatcher, delay)
    return
  }

  const message = `Windows app watcher crashed ${APP_WATCHER_CONFIG.MAX_RESTART_RETRIES} times, not restarting`
  log.error(`[AppWatcher:win] ${message}`)
  onEvent?.({
    type: 'error',
    timestamp: Date.now(),
    error: message,
  })
}

function spawnWatcher(): void {
  let executable: AppWatcherExecutable
  try {
    executable = getExecutable()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown executable resolution error'
    log.warn(`[AppWatcher:win] ${message}`)
    onEvent?.({
      type: 'error',
      timestamp: Date.now(),
      error: message,
    })
    return
  }

  log.info(`[AppWatcher:win] Spawning: ${executable.command} ${executable.args.join(' ')}`)
  const child = spawn(executable.command, [...executable.args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  proc = child
  log.info(`[AppWatcher:win] Process spawned (pid=${child.pid})`)

  const rl = createInterface({ input: child.stdout! })
  rl.on('line', (line) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      log.warn(`[AppWatcher:win] Could not parse line: ${line}`)
      return
    }

    if (!isAppWatcherEvent(parsed)) {
      log.warn(`[AppWatcher:win] Ignoring unexpected event shape: ${line}`)
      return
    }

    if (parsed.type === 'ready') {
      retries = 0
      log.info('[AppWatcher:win] Ready event received — watcher is alive')
    }

    try {
      onEvent?.(parsed)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`[AppWatcher:win] Event callback failed: ${message}`)
    }
  })

  child.stderr?.on('data', (data) => {
    const message = Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
    log.warn(`[AppWatcher:win] stderr: ${message.trim()}`)
  })

  child.on('error', (error) => {
    log.error(`[AppWatcher:win] Process error: ${error.message}`)
    onEvent?.({
      type: 'error',
      timestamp: Date.now(),
      error: error.message,
    })
  })

  child.on('close', (code, signal) => {
    proc = null
    log.info(`[AppWatcher:win] Process exited (code=${code}, signal=${signal}, stopped=${stopped})`)
    if (stopped) {
      return
    }
    scheduleRestartOrEmitFatalError()
  })
}

export function startAppWatcherWin(callback: (event: AppWatcherEvent) => void): void {
  if (proc) {
    log.info('[AppWatcher:win] Already running, skipping')
    return
  }

  stopped = false
  retries = 0
  onEvent = callback
  spawnWatcher()
}

export function stopAppWatcherWin(): void {
  stopped = true
  onEvent = null

  if (proc) {
    log.info(`[AppWatcher:win] Stopping (pid=${proc.pid})`)
    proc.kill('SIGTERM')
    proc = null
  }
}

export function isAppWatcherRunningWin(): boolean {
  return proc !== null && !proc.killed
}
