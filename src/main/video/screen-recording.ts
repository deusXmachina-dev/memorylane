import { ipcMain, systemPreferences, type WebContents } from 'electron'
import type {
  MainWindowStatus,
  ScreenRecorderFinishedPayload,
  ScreenRecorderStartedPayload,
} from '../../shared/types'
import { SCREEN_RECORDING_CHANNELS } from '../../shared/screen-recording'
import log from '../logger'
import { ScreenRecordingOutput, getScreenRecordingsDirectory } from './screen-recording-output'
import { ScreenRecordingRecorderWindow } from './screen-recording-recorder-window'

const RECORDER_START_TIMEOUT_MS = 30_000
const RECORDER_STOP_TIMEOUT_MS = 30_000

interface ScreenRecordingServiceOptions {
  onStatusChanged: () => void
}

interface Deferred {
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
}

export class ScreenRecordingService {
  private readonly recorderWindow: ScreenRecordingRecorderWindow
  private activeOutput: ScreenRecordingOutput | null = null
  private startDeferred: Deferred | null = null
  private stopDeferred: Deferred | null = null
  private isRecording = false

  constructor(private readonly options: ScreenRecordingServiceOptions) {
    this.recorderWindow = new ScreenRecordingRecorderWindow({
      onUnexpectedClose: (message) => {
        void this.failRecording(message)
      },
    })
    this.registerIpcHandlers()
  }

  getStatus(): Pick<MainWindowStatus, 'screenRecording' | 'recordingsDirectory'> {
    return {
      screenRecording: this.isRecording,
      recordingsDirectory: getScreenRecordingsDirectory(),
    }
  }

  async startRecording(): Promise<void> {
    if (this.isRecording || this.startDeferred || this.stopDeferred) {
      return
    }

    await this.ensureMicrophoneAccess()
    this.activeOutput = await ScreenRecordingOutput.create()
    this.startDeferred = createDeferred()

    try {
      await this.recorderWindow.ensureReady()
      this.recorderWindow.sendStart({
        includeMicrophone: true,
      })
      await waitForDeferred(
        this.startDeferred,
        RECORDER_START_TIMEOUT_MS,
        'Recording start timed out',
      )
    } catch (error) {
      const message = getErrorMessage(error)
      if (this.activeOutput) {
        await this.failRecording(message)
      } else {
        log.error('[ScreenRecording] Failed to start recording:', message)
      }
      throw error
    } finally {
      this.startDeferred = null
    }
  }

  async stopRecording(): Promise<void> {
    if (!this.activeOutput || this.stopDeferred) {
      return
    }

    this.stopDeferred = createDeferred()

    try {
      this.recorderWindow.sendStop()
      await waitForDeferred(this.stopDeferred, RECORDER_STOP_TIMEOUT_MS, 'Recording stop timed out')
    } catch (error) {
      if (this.activeOutput) {
        await this.failRecording(getErrorMessage(error))
      }
      throw error
    } finally {
      this.stopDeferred = null
    }
  }

  async dispose(): Promise<void> {
    if (this.activeOutput) {
      try {
        await this.stopRecording()
      } catch (error) {
        log.warn('[ScreenRecording] Failed to stop recording during shutdown:', error)
      }
    }
    this.recorderWindow.dispose()
  }

  private registerIpcHandlers(): void {
    ipcMain.handle(
      SCREEN_RECORDING_CHANNELS.started,
      async (event, payload: ScreenRecorderStartedPayload): Promise<void> => {
        if (!this.isRecorderEvent(event.sender) || !this.activeOutput) {
          return
        }

        void payload
        this.isRecording = true
        this.options.onStatusChanged()
        this.startDeferred?.resolve()
      },
    )

    ipcMain.handle(
      SCREEN_RECORDING_CHANNELS.writeChunk,
      async (event, chunk: Uint8Array | ArrayBuffer): Promise<void> => {
        if (!this.isRecorderEvent(event.sender) || !this.activeOutput) {
          return
        }

        const buffer = toNodeBuffer(chunk)
        await this.activeOutput.appendChunk(buffer)
      },
    )

    ipcMain.handle(
      SCREEN_RECORDING_CHANNELS.finished,
      async (event, payload: ScreenRecorderFinishedPayload): Promise<void> => {
        if (!this.isRecorderEvent(event.sender) || !this.activeOutput) {
          return
        }

        void payload
        await this.finishRecording()
      },
    )

    ipcMain.handle(
      SCREEN_RECORDING_CHANNELS.error,
      async (event, message: string): Promise<void> => {
        if (!this.isRecorderEvent(event.sender)) {
          return
        }

        await this.failRecording(message)
      },
    )
  }

  private async finishRecording(): Promise<void> {
    const output = this.activeOutput
    if (!output) return

    this.activeOutput = null
    this.isRecording = false

    try {
      const outputPath = await output.finalize()
      this.options.onStatusChanged()
      this.stopDeferred?.resolve()
      log.info('[ScreenRecording] Saved recording:', outputPath)
    } catch (error) {
      const message = `Failed to finalize recording: ${getErrorMessage(error)}`
      log.error('[ScreenRecording] Failed to finalize recording:', message)
      this.options.onStatusChanged()
      this.stopDeferred?.reject(new Error(message))
      throw error
    }
  }

  private async failRecording(message: string): Promise<void> {
    const output = this.activeOutput
    this.activeOutput = null
    this.isRecording = false
    this.options.onStatusChanged()

    if (output) {
      await output.cleanup()
    }

    const error = new Error(message)
    this.startDeferred?.reject(error)
    this.stopDeferred?.reject(error)
    log.error('[ScreenRecording] Recording failed:', message)
  }

  private async ensureMicrophoneAccess(): Promise<void> {
    if (process.platform !== 'darwin') {
      return
    }

    const currentStatus = systemPreferences.getMediaAccessStatus('microphone')
    if (currentStatus === 'granted') {
      return
    }

    const granted = await systemPreferences.askForMediaAccess('microphone')
    if (!granted) {
      throw new Error('Microphone access is required to save screen recordings with audio')
    }
  }

  private isRecorderEvent(sender: WebContents): boolean {
    return this.recorderWindow.owns(sender)
  }
}

function createDeferred(): Deferred {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

async function waitForDeferred(
  deferred: Deferred,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<void> {
  await Promise.race([
    deferred.promise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(timeoutMessage))
      }, timeoutMs)
      deferred.promise.finally(() => clearTimeout(timer))
    }),
  ])
}

function toNodeBuffer(chunk: Uint8Array | ArrayBuffer): Buffer {
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk)
  }
  return Buffer.from(chunk)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
