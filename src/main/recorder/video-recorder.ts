/**
 * Screen video recorder using a hidden BrowserWindow + MediaRecorder.
 *
 * Dev-only test utility for capturing screen recordings to disk.
 * Uses getDisplayMedia() in a hidden renderer, with
 * setDisplayMediaRequestHandler to auto-select the primary screen.
 */

import { BrowserWindow, desktopCapturer, session } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import log from '../logger'

let recorderWindow: BrowserWindow | null = null
let recording = false

/**
 * Start recording the primary screen.
 */
export async function startRecording(): Promise<void> {
  if (recording) {
    log.warn('[VideoRecorder] Already recording')
    return
  }

  // Auto-select primary screen when the hidden renderer calls getDisplayMedia
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] })
    if (sources.length === 0) {
      log.error('[VideoRecorder] No screen sources available')
      callback({ video: undefined })
      return
    }
    callback({ video: sources[0] })
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

  recording = true
  log.info('[VideoRecorder] Recording started')
}

/**
 * Stop recording and save the video to `outputPath`.
 * Returns the absolute path of the saved file.
 */
export async function stopRecording(outputPath: string): Promise<string> {
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

  // Tear down hidden window & restore handler
  recorderWindow.close()
  recorderWindow = null
  session.defaultSession.setDisplayMediaRequestHandler(null)

  // Write the file
  const buffer = Buffer.from(base64Data, 'base64')
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, buffer)

  log.info(`[VideoRecorder] Saved ${outputPath} (${buffer.length} bytes)`)
  return outputPath
}

/**
 * Whether a recording is currently in progress.
 */
export function isRecordingNow(): boolean {
  return recording
}

/**
 * Generate a timestamped output path inside the given directory.
 */
export function buildOutputPath(dir: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  return path.join(dir, `recording-${ts}.webm`)
}
