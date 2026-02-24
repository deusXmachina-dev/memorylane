import * as fs from 'fs'
import * as path from 'path'
import log from '../../logger'
import {
  DesktopCaptureBackend,
  DesktopCaptureOptions,
  DesktopCaptureResult,
} from './native-screenshot-backend'
import { captureDesktopMacOS } from './native-screenshot-mac'

export type { DesktopCaptureOptions, DesktopCaptureResult } from './native-screenshot-backend'

const PLATFORM_CAPTURE_BACKENDS: Partial<Record<NodeJS.Platform, DesktopCaptureBackend>> = {
  darwin: captureDesktopMacOS,
}

function ensureParentDirExists(outputPath: string): void {
  const parentDir = path.dirname(outputPath)
  fs.mkdirSync(parentDir, { recursive: true })
}

export function resolveDesktopCaptureBackend(
  platform: NodeJS.Platform = process.platform,
): DesktopCaptureBackend {
  const backend = PLATFORM_CAPTURE_BACKENDS[platform]
  if (backend) {
    return backend
  }

  throw new Error(
    `[NativeScreenshot:backend_unavailable] Desktop capture backend is not implemented for platform "${platform}"`,
  )
}

export async function captureDesktop(
  options: DesktopCaptureOptions,
): Promise<DesktopCaptureResult> {
  ensureParentDirExists(options.outputPath)
  const backend = resolveDesktopCaptureBackend()
  const output = await backend(options)

  log.debug(
    `[NativeScreenshot] Screen captured display=${output.displayId} size=${output.width}x${output.height}`,
  )
  return {
    filepath: output.filepath,
    width: output.width,
    height: output.height,
    displayId: output.displayId,
  }
}
