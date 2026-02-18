/**
 * Video recorder dispatcher.
 *
 * Routes to the native macOS backend (ScreenCaptureKit, H.264/MP4) when
 * available. Non-macOS platforms get no video support — the module simply
 * won't initialize and ActivityManager runs without a video provider.
 */

import { app } from 'electron'
import * as path from 'path'
import type { VideoSegment, OnSegmentCallback } from '../../shared/types'
import log from '../logger'

const DEFAULT_RECORDINGS_DIR = path.join(app.getPath('userData'), 'recordings')

interface VideoRecorderBackend {
  start(): Promise<void>
  stop(): Promise<void>
  split(displayId: number): Promise<VideoSegment>
  onSegment(callback: OnSegmentCallback): void
  isRunning(): boolean
  getRecordingsDir(): string
  isAvailable(): boolean
}

let backend: VideoRecorderBackend | null = null

async function getBackend(): Promise<VideoRecorderBackend | null> {
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
      log.warn('[VideoRecorder] Failed to load macOS backend:', err)
    }
  }

  log.info('[VideoRecorder] No video recorder backend available on this platform')
  return null
}

export async function start(): Promise<void> {
  const b = await getBackend()
  if (!b) throw new Error('No video recorder backend available')
  return b.start()
}

export async function stop(): Promise<void> {
  if (!backend) return
  return backend.stop()
}

export function split(displayId: number): Promise<VideoSegment> {
  if (!backend) {
    return Promise.reject(new Error('Video recorder backend not initialized'))
  }
  return backend.split(displayId)
}

export function onSegment(callback: OnSegmentCallback): void {
  if (backend) {
    backend.onSegment(callback)
  } else {
    getBackend().then((b) => b?.onSegment(callback))
  }
}

export function isRunning(): boolean {
  return backend?.isRunning() ?? false
}

export function isAvailable(): boolean {
  return backend?.isAvailable() ?? false
}

export function getRecordingsDir(): string {
  return backend?.getRecordingsDir() ?? DEFAULT_RECORDINGS_DIR
}
