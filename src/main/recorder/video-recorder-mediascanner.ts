/**
 * Screen video recorder using a hidden BrowserWindow + MediaRecorder.
 *
 * Records the primary screen to WebM files in {userData}/recordings/.
 * Uses getDisplayMedia() in a hidden renderer, with
 * setDisplayMediaRequestHandler to auto-select the primary screen.
 *
 * Cross-platform fallback backend for video-recorder.ts dispatcher.
 */

import { app, BrowserWindow, desktopCapturer, session } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
// eslint-disable-next-line import/no-unresolved
import { v4 as uuidv4 } from 'uuid'
import type { VideoRecording } from '../../shared/types'
import log from '../logger'

const RECORDINGS_DIR = path.join(app.getPath('userData'), 'recordings')

let recorderWindow: BrowserWindow | null = null
let recording = false
let recordingStartTimestamp = 0

function ensureRecordingsDir(): void {
  if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true })
  }
}

/**
 * Start recording the primary screen.
 */
export async function startRecording(options?: { displayId?: number }): Promise<void> {
  if (recording) {
    log.warn('[VideoRecorder] Already recording')
    return
  }

  // Auto-select screen when the hidden renderer calls getDisplayMedia
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] })
    if (sources.length === 0) {
      log.error('[VideoRecorder] No screen sources available')
      callback({ video: undefined })
      return
    }

    const source =
      (options?.displayId !== undefined
        ? sources.find((s) => s.display_id === String(options.displayId))
        : undefined) ?? sources[0]

    callback({ video: source })
  })

  recorderWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  recorderWindow.on('closed', () => {
    recorderWindow = null
    if (recording) {
      recording = false
      log.warn('[VideoRecorder] Window closed unexpectedly while recording')
    }
  })

  await recorderWindow.loadURL('about:blank')

  await recorderWindow.webContents.executeJavaScript(`
    (async () => {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 10 },
        audio: false,
      });

      window._recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      window._chunks = [];

      window._recorder.ondataavailable = (e) => {
        if (e.data.size > 0) window._chunks.push(e.data);
      };

      window._recorder.start(1000);
      return true;
    })()
  `)

  recordingStartTimestamp = Date.now()
  recording = true
  log.info('[VideoRecorder] Recording started')
}

/**
 * Stop recording and save the video.
 * Returns metadata about the saved recording.
 */
export async function stopRecording(): Promise<VideoRecording> {
  if (!recording || !recorderWindow) {
    throw new Error('Not recording')
  }

  // Stop the MediaRecorder and retrieve the video data as base64
  const base64Data: string = await recorderWindow.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      if (!window._recorder || window._recorder.state === 'inactive') {
        reject(new Error('Recorder not active'));
        return;
      }

      window._recorder.onstop = async () => {
        try {
          const blob = new Blob(window._chunks, { type: 'video/webm' });
          const buffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          const chunkSize = 8192;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, Array.from(slice));
          }
          resolve(btoa(binary));
        } catch (err) {
          reject(err);
        }
      };

      window._recorder.stop();
      window._recorder.stream.getTracks().forEach(t => t.stop());
    })
  `)

  recording = false
  const endTimestamp = Date.now()

  // Tear down hidden window & restore handler
  recorderWindow.close()
  recorderWindow = null
  session.defaultSession.setDisplayMediaRequestHandler(null)

  // Write the file
  ensureRecordingsDir()
  const id = uuidv4()
  const filename = `${recordingStartTimestamp}_${id}.webm`
  const filepath = path.join(RECORDINGS_DIR, filename)

  const buffer = Buffer.from(base64Data, 'base64')
  fs.writeFileSync(filepath, buffer)

  const result: VideoRecording = {
    id,
    filepath,
    startTimestamp: recordingStartTimestamp,
    endTimestamp,
    display: { id: 0, width: 0, height: 0 },
    format: 'webm',
  }

  log.info(
    `[VideoRecorder] Saved ${filename} (${buffer.length} bytes, ${((endTimestamp - recordingStartTimestamp) / 1000).toFixed(1)}s)`,
  )

  return result
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

/**
 * MediaScanner backend is always available (cross-platform).
 */
export function isAvailable(): boolean {
  return true
}
