/**
 * Video recorder dispatcher.
 *
 * Routes to the native macOS backend (ScreenCaptureKit, H.264/MP4) when
 * available, otherwise falls back to the MediaRecorder backend (WebM).
 */

import { app } from 'electron'
import * as path from 'path'
import type { VideoRecording } from '../../shared/types'
import log from '../logger'

const DEFAULT_RECORDINGS_DIR = path.join(app.getPath('userData'), 'recordings')

interface VideoRecorderBackend {
  startRecording(options?: { displayId?: number }): Promise<void>
  stopRecording(): Promise<VideoRecording>
  isRecording(): boolean
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

  const mediascanner = await import('./video-recorder-mediascanner')
  backend = mediascanner
  log.info('[VideoRecorder] Using MediaRecorder fallback backend')
  return backend
}

export async function startRecording(options?: { displayId?: number }): Promise<void> {
  const b = await getBackend()
  return b.startRecording(options)
}

export async function stopRecording(): Promise<VideoRecording> {
  const b = await getBackend()
  return b.stopRecording()
}

export function isRecording(): boolean {
  // Sync method — backend may not be resolved yet
  return backend?.isRecording() ?? false
}

export function getRecordingsDir(): string {
  return backend?.getRecordingsDir() ?? DEFAULT_RECORDINGS_DIR
}
