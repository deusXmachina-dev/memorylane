/**
 * Native macOS video recorder using ScreenCaptureKit.
 *
 * Manages a long-lived Swift subprocess that continuously records all displays.
 * Segment splitting is triggered via stdin commands — zero-gap, no process restarts.
 * Follows the app-watcher.ts pattern for process lifecycle and auto-restart.
 */

import { spawn, ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
// eslint-disable-next-line import/no-unresolved
import { v4 as uuidv4 } from 'uuid'
import type { VideoSegment, OnSegmentCallback } from '../../shared/types'
import log from '../logger'

const RECORDINGS_DIR = path.join(app.getPath('userData'), 'recordings')
const MAX_RESTART_RETRIES = 3
const RESTART_BACKOFF_MS = 1000
const SPLIT_TIMEOUT_MS = 15_000

let proc: ChildProcess | null = null
let running = false
let stopped = false
let retries = 0
const segmentCallbacks: OnSegmentCallback[] = []

interface PendingSplit {
  resolve: (segment: VideoSegment) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
}

const pendingSplits: Map<number, PendingSplit> = new Map()

interface SwiftExecutable {
  readonly command: string
  readonly args: readonly string[]
}

function getExecutable(): SwiftExecutable {
  let isPackaged = false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    isPackaged = require('electron').app.isPackaged
  } catch {
    // Running under ELECTRON_RUN_AS_NODE — treat as dev
  }

  log.debug(`[VideoRecorderMac] Resolving executable (isPackaged=${isPackaged})`)

  if (isPackaged) {
    const binaryPath = path.join(process.resourcesPath, 'swift', 'screen-recorder')
    log.debug(`[VideoRecorderMac] Checking packaged binary at: ${binaryPath}`)
    if (fs.existsSync(binaryPath)) {
      return { command: binaryPath, args: [] }
    }
    throw new Error(`screen-recorder binary not found at ${binaryPath}`)
  }

  // Prefer pre-compiled binary (from npm run build:swift)
  const devBinaryPath = path.resolve(process.cwd(), 'build', 'swift', 'screen-recorder')
  log.debug(`[VideoRecorderMac] Checking dev binary at: ${devBinaryPath}`)
  if (fs.existsSync(devBinaryPath)) {
    return { command: devBinaryPath, args: [] }
  }

  // Fall back to JIT-compiling the Swift script
  const scriptPath = path.resolve(
    process.cwd(),
    'src',
    'main',
    'recorder',
    'swift',
    'screen-recorder.swift',
  )
  log.debug(`[VideoRecorderMac] Checking dev script at: ${scriptPath}`)
  if (fs.existsSync(scriptPath)) {
    return {
      command: 'swift',
      args: [
        scriptPath,
        '-framework',
        'ScreenCaptureKit',
        '-framework',
        'AVFoundation',
        '-framework',
        'CoreMedia',
        '-framework',
        'VideoToolbox',
      ],
    }
  }

  throw new Error(`screen-recorder not found at ${devBinaryPath} or ${scriptPath}`)
}

function ensureRecordingsDir(): void {
  if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true })
  }
}

/**
 * Check if the native macOS recorder is available.
 */
export function isAvailable(): boolean {
  try {
    getExecutable()
    return true
  } catch {
    return false
  }
}

/**
 * Start the persistent recording process.
 * Records all connected displays continuously.
 */
export async function start(): Promise<void> {
  if (running) {
    log.warn('[VideoRecorderMac] Already running')
    return
  }

  ensureRecordingsDir()
  stopped = false
  retries = 0

  return spawnProcess()
}

function spawnProcess(): Promise<void> {
  const { command, args } = getExecutable()
  const swiftArgs = [...args, RECORDINGS_DIR, '--width', '1280', '--height', '720', '--fps', '5']

  log.info(`[VideoRecorderMac] Spawning: ${command} ${swiftArgs.join(' ')}`)

  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, swiftArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
    proc = child

    const rl = createInterface({ input: child.stdout! })
    let resolved = false

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        reject(new Error('Timed out waiting for recording to start'))
        child.kill('SIGTERM')
      }
    }, 30_000)

    rl.on('line', (line) => {
      log.debug(`[VideoRecorderMac] stdout: ${line}`)
      try {
        const event = JSON.parse(line)

        if (event.status === 'recording' && !resolved) {
          resolved = true
          clearTimeout(timeout)
          running = true
          retries = 0
          log.info(
            `[VideoRecorderMac] Recording started on displays: ${JSON.stringify(event.displays)}`,
          )
          resolve()
        } else if (event.status === 'error') {
          log.error(`[VideoRecorderMac] Error from subprocess: ${event.message}`)
          if (!resolved) {
            resolved = true
            clearTimeout(timeout)
            reject(new Error(event.message))
          }
        } else if (event.status === 'segment_complete') {
          const segment: VideoSegment = {
            id: uuidv4(),
            filepath: event.filepath,
            displayId: event.displayId,
            startTimestamp: event.startTimestamp,
            endTimestamp: event.endTimestamp,
          }
          log.info(
            `[VideoRecorderMac] Segment complete: ${path.basename(segment.filepath)} ` +
              `display=${segment.displayId} ` +
              `duration=${((segment.endTimestamp - segment.startTimestamp) / 1000).toFixed(1)}s`,
          )

          // Resolve any pending split promise for this display
          const pending = pendingSplits.get(segment.displayId)
          if (pending) {
            clearTimeout(pending.timeout)
            pendingSplits.delete(segment.displayId)
            pending.resolve(segment)
          }

          // Also invoke general callbacks (for logging, monitoring, etc.)
          segmentCallbacks.forEach((cb) => {
            try {
              cb(segment)
            } catch (err) {
              log.error('[VideoRecorderMac] Error in segment callback:', err)
            }
          })
        } else if (event.status === 'stopped') {
          log.info('[VideoRecorderMac] Process reported stopped')
        }
      } catch {
        log.warn(`[VideoRecorderMac] Could not parse line: ${line}`)
      }
    })

    child.stderr?.on('data', (data) => {
      log.warn(`[VideoRecorderMac] stderr: ${data.toString().trim()}`)
    })

    child.on('error', (err) => {
      log.error(`[VideoRecorderMac] Process error: ${err.message}`)
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        reject(err)
      }
    })

    child.on('close', (code, signal) => {
      log.info(
        `[VideoRecorderMac] Process exited (code=${code}, signal=${signal}, stopped=${stopped})`,
      )
      proc = null
      running = false

      // Reject all pending splits
      for (const [displayId, pending] of pendingSplits) {
        clearTimeout(pending.timeout)
        pending.reject(new Error(`Video recorder process exited (code=${code})`))
        pendingSplits.delete(displayId)
      }

      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        reject(new Error(`screen-recorder exited with code ${code} before starting`))
        return
      }

      // Auto-restart on unexpected exit
      if (!stopped) {
        if (retries < MAX_RESTART_RETRIES) {
          retries++
          const delay = RESTART_BACKOFF_MS * retries
          log.info(
            `[VideoRecorderMac] Restarting in ${delay}ms (attempt ${retries}/${MAX_RESTART_RETRIES})`,
          )
          setTimeout(() => {
            if (!stopped) {
              spawnProcess().catch((err) => {
                log.error(`[VideoRecorderMac] Restart failed: ${err.message}`)
              })
            }
          }, delay)
        } else {
          log.error(`[VideoRecorderMac] Max retries (${MAX_RESTART_RETRIES}) reached, giving up`)
        }
      }
    })
  })
}

/**
 * Stop the recording process gracefully.
 */
export async function stop(): Promise<void> {
  if (!proc) {
    running = false
    return
  }

  stopped = true

  return new Promise<void>((resolve) => {
    const child = proc!

    const timeout = setTimeout(() => {
      log.warn('[VideoRecorderMac] Stop timed out, killing process')
      child.kill('SIGTERM')
      running = false
      proc = null
      resolve()
    }, 10_000)

    child.on('close', () => {
      clearTimeout(timeout)
      running = false
      proc = null
      resolve()
    })

    // Send stop command via stdin
    log.info('[VideoRecorderMac] Sending stop command')
    child.stdin!.write(JSON.stringify({ command: 'stop' }) + '\n')
  })
}

/**
 * Trigger a segment split on a specific display.
 * Returns a promise that resolves with the completed VideoSegment.
 */
export function split(displayId: number): Promise<VideoSegment> {
  if (!proc || !running) {
    return Promise.reject(new Error('Cannot split — video recorder not running'))
  }

  // If there's already a pending split for this display, supersede it
  const existing = pendingSplits.get(displayId)
  if (existing) {
    clearTimeout(existing.timeout)
    existing.reject(new Error(`Superseded by new split request for display ${displayId}`))
    pendingSplits.delete(displayId)
  }

  const newFilename = `${Date.now()}_${displayId}_${uuidv4()}.mp4`
  const newOutputPath = path.join(RECORDINGS_DIR, newFilename)

  const cmd = JSON.stringify({ command: 'split', displayId, outputPath: newOutputPath })
  log.debug(`[VideoRecorderMac] Sending split: ${cmd}`)
  proc.stdin!.write(cmd + '\n')

  return new Promise<VideoSegment>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingSplits.delete(displayId)
      reject(new Error(`Split timed out for display ${displayId} after ${SPLIT_TIMEOUT_MS}ms`))
    }, SPLIT_TIMEOUT_MS)

    pendingSplits.set(displayId, { resolve, reject, timeout })
  })
}

/**
 * Register a callback for completed segments.
 */
export function onSegment(callback: OnSegmentCallback): void {
  segmentCallbacks.push(callback)
}

/**
 * Whether the recording process is currently running.
 */
export function isRunning(): boolean {
  return running
}

/**
 * Get the directory where recordings are saved.
 */
export function getRecordingsDir(): string {
  return RECORDINGS_DIR
}
