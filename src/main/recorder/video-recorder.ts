/**
 * Video recorder dispatcher.
 *
 * Routes to the native macOS backend (ScreenCaptureKit, H.264/MP4) when
 * available. The MediaRecorder fallback provides stub implementations for
 * the new split/onSegment API so the dispatcher compiles on all platforms.
 */

import { app } from 'electron'
import * as path from 'path'
import type { OnSegmentCallback } from '../../shared/types'
import log from '../logger'

const DEFAULT_RECORDINGS_DIR = path.join(app.getPath('userData'), 'recordings')

interface VideoRecorderBackend {
  start(): Promise<void>
  stop(): Promise<void>
  split(displayId: number): void
  onSegment(callback: OnSegmentCallback): void
  isRunning(): boolean
  getRecordingsDir(): string
  isAvailable(): boolean
}

let backend: VideoRecorderBackend | null = null

async function getBackend(): Promise<VideoRecorderBackend> {
  if (backend) return backend

  if (process.platform === 'darwin') {
    try {
      const mac = await import('./video-recorder-mac')
      if (mac.isAvailable()) {
        backend = mac
        log.info('[VideoRecorder] Using native macOS backend (ScreenCaptureKit)')
        return backend
      }
    } catch (err) {
      log.warn('[VideoRecorder] Failed to load macOS backend, falling back:', err)
    }
  }

  // Fallback with stub implementations for split/onSegment
  const mediascanner = await import('./video-recorder-mediascanner')
  backend = {
    start: mediascanner.startRecording,
    stop: async () => {
      await mediascanner.stopRecording()
    },
    split: () => {
      /* no-op on non-macOS */
    },
    onSegment: () => {
      /* no-op on non-macOS */
    },
    isRunning: mediascanner.isRecording,
    getRecordingsDir: mediascanner.getRecordingsDir,
    isAvailable: mediascanner.isAvailable,
  }
  log.info('[VideoRecorder] Using MediaRecorder fallback backend')
  return backend
}

export async function start(): Promise<void> {
  const b = await getBackend()
  return b.start()
}

export async function stop(): Promise<void> {
  const b = await getBackend()
  return b.stop()
}

export function split(displayId: number): void {
  backend?.split(displayId)
}

export function onSegment(callback: OnSegmentCallback): void {
  if (backend) {
    backend.onSegment(callback)
  } else {
    // Backend not yet initialized — defer registration to start()
    getBackend().then((b) => b.onSegment(callback))
  }
}

export function isRunning(): boolean {
  return backend?.isRunning() ?? false
}

export function getRecordingsDir(): string {
  return backend?.getRecordingsDir() ?? DEFAULT_RECORDINGS_DIR
}
