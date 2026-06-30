import { spawn, ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import * as path from 'path'
import * as fs from 'fs'
import { APP_WATCHER_CONFIG } from '@constants'
import { AppWatcherEvent } from './app-watcher'
import log from '@main/utils/logger'

let proc: ChildProcess | null = null
let onEvent: ((event: AppWatcherEvent) => void) | null = null
let retries = 0
let stopped = false

interface AppWatcherExecutable {
  readonly command: string
  readonly args: readonly string[]
}

function getExecutable(): AppWatcherExecutable {
  let isPackaged = false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    isPackaged = require('electron').app.isPackaged
  } catch {
    // Running under ELECTRON_RUN_AS_NODE — treat as dev
  }

  log.debug(`[AppWatcher] Resolving executable (isPackaged=${isPackaged})`)

  if (isPackaged) {
    const binaryPath = path.join(process.resourcesPath, 'swift', 'app-watcher')
    log.debug(`[AppWatcher] Checking packaged binary at: ${binaryPath}`)
    if (fs.existsSync(binaryPath)) {
      return { command: binaryPath, args: [] }
    }
    throw new Error(`app-watcher binary not found at ${binaryPath}`)
  }

  const scriptPath = path.resolve(
    process.cwd(),
    'src',
    'main',
    'recorder',
    'swift',
    'app-watcher.swift',
  )
  log.debug(`[AppWatcher] Checking dev script at: ${scriptPath}`)
  if (fs.existsSync(scriptPath)) {
    return { command: 'swift', args: [scriptPath] }
  }

  throw new Error(`app-watcher script not found at ${scriptPath}`)
}

function spawnWatcher(): void {
  const { command, args } = getExecutable()
  log.debug(`[AppWatcher] Spawning: ${command} ${args.join(' ')}`)

  const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
  proc = child
  log.debug(`[AppWatcher] Process spawned (pid=${child.pid})`)

  const rl = createInterface({ input: child.stdout! })

  rl.on('line', (line) => {
    try {
      const event: AppWatcherEvent = JSON.parse(line)
      if (event.type === 'ready') {
        retries = 0 // successful start, reset backoff
        log.debug('[AppWatcher] Ready event received — watcher is alive')
      }
      onEvent?.(event)
    } catch {
      log.warn(`[AppWatcher] Could not parse line: ${line}`)
    }
  })

  child.stderr?.on('data', (data) => {
    log.warn(`[AppWatcher] stderr: ${data.toString().trim()}`)
  })

  child.on('error', (err) => {
    log.error(`[AppWatcher] Process error: ${err.message}`)
    onEvent?.({ type: 'error', timestamp: Date.now(), error: err.message })
  })

  child.on('close', (code, signal) => {
    if (stopped) {
      log.debug(`[AppWatcher] Process exited (code=${code}, signal=${signal}, stopped=true)`)
    } else {
      log.warn(`[AppWatcher] Process exited unexpectedly (code=${code}, signal=${signal})`)
    }
    proc = null
    if (stopped) return
    if (retries < APP_WATCHER_CONFIG.MAX_RESTART_RETRIES) {
      retries++
      const delay = APP_WATCHER_CONFIG.RESTART_BACKOFF_MS * retries
      log.info(
        `[AppWatcher] Restarting in ${delay}ms (attempt ${retries}/${APP_WATCHER_CONFIG.MAX_RESTART_RETRIES})`,
      )
      setTimeout(spawnWatcher, delay)
    } else {
      log.error(
        `[AppWatcher] Max retries (${APP_WATCHER_CONFIG.MAX_RESTART_RETRIES}) reached, giving up`,
      )
      onEvent?.({
        type: 'error',
        timestamp: Date.now(),
        error: `app-watcher crashed ${APP_WATCHER_CONFIG.MAX_RESTART_RETRIES} times, not restarting`,
      })
    }
  })
}

export function startAppWatcherMac(callback: (event: AppWatcherEvent) => void): void {
  log.debug(`[AppWatcher] startAppWatcherMac called (proc=${!!proc}, stopped=${stopped})`)
  if (proc) {
    log.debug('[AppWatcher] Already running, skipping')
    return
  }

  stopped = false
  retries = 0
  onEvent = callback
  log.debug('[AppWatcher] Spawning watcher process...')
  spawnWatcher()
}

export function stopAppWatcherMac(): void {
  stopped = true
  onEvent = null

  if (proc) {
    log.debug(`[AppWatcher] Stopping (pid=${proc.pid})`)
    proc.kill('SIGTERM')
    proc = null
  }
}

export function isAppWatcherRunningMac(): boolean {
  return proc !== null && !proc.killed
}
