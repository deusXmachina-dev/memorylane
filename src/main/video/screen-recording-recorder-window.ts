import path from 'node:path'
import { app, BrowserWindow, desktopCapturer, screen, session, type WebContents } from 'electron'
import type { ScreenRecorderStartOptions } from '../../shared/types'
import { SCREEN_RECORDING_CHANNELS } from '../../shared/screen-recording'
import log from '../logger'

interface ScreenRecordingRecorderWindowOptions {
  onUnexpectedClose: (message: string) => void
}

export class ScreenRecordingRecorderWindow {
  private recorderWindow: BrowserWindow | null = null
  private recorderWindowReady: Promise<void> | null = null
  private disposing = false

  constructor(private readonly options: ScreenRecordingRecorderWindowOptions) {
    registerDisplayMediaHandler()
  }

  async ensureReady(): Promise<void> {
    if (this.recorderWindow && !this.recorderWindow.isDestroyed()) {
      if (this.recorderWindow.webContents.isLoading()) {
        await this.recorderWindowReady
      }
      return
    }

    const appRoot = app.getAppPath()
    const preloadPath = path.join(appRoot, 'out', 'preload', 'index.js')

    this.recorderWindow = new BrowserWindow({
      width: 320,
      height: 180,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })

    this.recorderWindow.on('closed', () => {
      this.recorderWindow = null
      this.recorderWindowReady = null
      if (!this.disposing) {
        this.options.onUnexpectedClose('Recording window closed unexpectedly')
      }
    })

    this.recorderWindow.webContents.on('render-process-gone', () => {
      if (!this.disposing) {
        this.options.onUnexpectedClose('Recording process exited unexpectedly')
      }
    })

    this.recorderWindowReady = new Promise<void>((resolve, reject) => {
      const handleReady = (): void => {
        cleanup()
        resolve()
      }
      const handleFail = (_event: Event, code: number, description: string): void => {
        cleanup()
        reject(new Error(`Failed to load recorder window (${code}): ${description}`))
      }
      const cleanup = (): void => {
        this.recorderWindow?.webContents.removeListener('did-finish-load', handleReady)
        this.recorderWindow?.webContents.removeListener('did-fail-load', handleFail)
      }

      this.recorderWindow?.webContents.once('did-finish-load', handleReady)
      this.recorderWindow?.webContents.once('did-fail-load', handleFail)
    })

    if (app.isPackaged) {
      await this.recorderWindow.loadFile(
        path.join(appRoot, 'out', 'renderer', 'screen-recorder.html'),
      )
    } else {
      await this.recorderWindow.loadURL('http://localhost:5173/screen-recorder.html')
    }

    await this.recorderWindowReady
  }

  sendStart(options: ScreenRecorderStartOptions): void {
    this.recorderWindow?.webContents.send(SCREEN_RECORDING_CHANNELS.start, options)
  }

  sendStop(): void {
    this.recorderWindow?.webContents.send(SCREEN_RECORDING_CHANNELS.stop)
  }

  owns(sender: WebContents): boolean {
    return Boolean(this.recorderWindow && this.recorderWindow.webContents.id === sender.id)
  }

  dispose(): void {
    this.disposing = true
    if (this.recorderWindow && !this.recorderWindow.isDestroyed()) {
      this.recorderWindow.destroy()
    }
    this.recorderWindow = null
    this.recorderWindowReady = null
    this.disposing = false
  }
}

let displayMediaHandlerRegistered = false

function registerDisplayMediaHandler(): void {
  if (displayMediaHandlerRegistered) {
    return
  }

  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const source = await getPrimaryDisplaySource()
        callback(source ? { video: source } : {})
      } catch (error) {
        log.error('[ScreenRecording] Failed to resolve display source:', error)
        callback({})
      }
    },
    { useSystemPicker: false },
  )

  displayMediaHandlerRegistered = true
}

async function getPrimaryDisplaySource() {
  const primaryDisplay = screen.getPrimaryDisplay()
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1, height: 1 },
  })

  return (
    sources.find((candidate) => candidate.display_id === String(primaryDisplay.id)) ??
    sources[0] ??
    null
  )
}
