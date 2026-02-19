import { NativeCaptureBackend } from './capture-native'
import { ElectronCaptureBackend } from './capture-electron'

export interface CaptureResult {
  width: number
  height: number
  displayId: number
}

export interface CaptureBackend {
  captureScreen(outputPath: string, displayId?: number): Promise<CaptureResult>
  captureSampleBitmap(displayId?: number): Promise<Buffer>
  captureWindow(title: string, outputPath: string): Promise<CaptureResult | null>
  start(): void
  stop(): void
}

export function createCaptureBackend(): CaptureBackend {
  if (process.platform === 'darwin') {
    return new NativeCaptureBackend()
  }
  return new ElectronCaptureBackend()
}
