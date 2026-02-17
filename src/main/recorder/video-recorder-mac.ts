/**
 * Native macOS video recorder using ScreenCaptureKit.
 *
 * Spawns a Swift subprocess that records the screen to H.264/MP4.
 * Follows the app-watcher.ts pattern for Swift process management.
 */

import { spawn, ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
// eslint-disable-next-line import/no-unresolved
import { v4 as uuidv4 } from 'uuid'
import type { VideoRecording } from '../../shared/types'
import log from '../logger'

const RECORDINGS_DIR = path.join(app.getPath('userData'), 'recordings')

let proc: ChildProcess | null = null
let recording = false
let recordingStartTimestamp = 0
let currentOutputPath = ''

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

  throw new Error(`screen-recorder script not found at ${scriptPath}`)
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
 * Start recording the primary screen.
 */
export async function startRecording(options?: { displayId?: number }): Promise<void> {
  if (recording) {
    log.warn('[VideoRecorderMac] Already recording')
    return
  }

  ensureRecordingsDir()

  const id = uuidv4()
  recordingStartTimestamp = Date.now()
  const filename = `${recordingStartTimestamp}_${id}.mp4`
  currentOutputPath = path.join(RECORDINGS_DIR, filename)

  const { command, args } = getExecutable()
  const swiftArgs = [...args, currentOutputPath, '--width', '1280', '--height', '720', '--fps', '5']

  if (options?.displayId !== undefined) {
    swiftArgs.push('--display', String(options.displayId))
  }

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
          recording = true
          log.info('[VideoRecorderMac] Recording started')
          resolve()
        } else if (event.status === 'error' && !resolved) {
          resolved = true
          clearTimeout(timeout)
          reject(new Error(event.message))
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

    child.on('close', (code) => {
      proc = null
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        reject(new Error(`screen-recorder exited with code ${code} before starting`))
      }
    })
  })
}

/**
 * Stop recording and return metadata about the saved file.
 */
export async function stopRecording(): Promise<VideoRecording> {
  if (!recording || !proc) {
    throw new Error('Not recording')
  }

  return new Promise<VideoRecording>((resolve, reject) => {
    const child = proc!

    const timeout = setTimeout(() => {
      log.warn('[VideoRecorderMac] Stop timed out, killing process')
      child.kill('SIGTERM')
      reject(new Error('Timed out waiting for recording to stop'))
    }, 10_000)

    const rl = createInterface({ input: child.stdout! })

    rl.on('line', (line) => {
      log.debug(`[VideoRecorderMac] stdout (stop): ${line}`)
      try {
        const event = JSON.parse(line)
        if (event.status === 'stopped') {
          clearTimeout(timeout)
          recording = false
          proc = null

          const endTimestamp = Date.now()
          const result: VideoRecording = {
            id: path.basename(currentOutputPath, '.mp4').split('_').slice(1).join('_'),
            filepath: event.filepath || currentOutputPath,
            startTimestamp: recordingStartTimestamp,
            endTimestamp,
            display: { id: 0, width: 1280, height: 720 },
            format: 'mp4',
          }

          log.info(
            `[VideoRecorderMac] Saved ${path.basename(result.filepath)} (${((endTimestamp - recordingStartTimestamp) / 1000).toFixed(1)}s)`,
          )
          resolve(result)
        } else if (event.status === 'error') {
          clearTimeout(timeout)
          recording = false
          proc = null
          reject(new Error(event.message))
        }
      } catch {
        // ignore parse errors during stop
      }
    })

    child.on('close', () => {
      clearTimeout(timeout)
      if (recording) {
        recording = false
        proc = null
        reject(new Error('screen-recorder exited unexpectedly during stop'))
      }
    })

    // Send stop signal: write newline to stdin
    log.info('[VideoRecorderMac] Sending stop signal')
    child.stdin!.write('\n')
  })
}

/**
 * Whether a recording is currently in progress.
 */
export function isRecording(): boolean {
  return recording
}

/**
 * Get the directory where recordings are saved.
 */
export function getRecordingsDir(): string {
  return RECORDINGS_DIR
}
