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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeCaptureBackend } = require('./capture-native')
    return new NativeCaptureBackend()
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ElectronCaptureBackend } = require('./capture-electron')
  return new ElectronCaptureBackend()
}
