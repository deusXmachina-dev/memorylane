export interface DesktopCaptureOptions {
  outputPath: string
  displayId?: number
  maxDimensionPx?: number
}

export interface DesktopCaptureResult {
  filepath: string
  width: number
  height: number
  displayId: number
}

export type DesktopCaptureBackend = (
  options: DesktopCaptureOptions,
) => Promise<DesktopCaptureResult>
