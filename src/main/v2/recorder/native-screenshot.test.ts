import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopCaptureResult } from './native-screenshot-backend'

const ORIGINAL_PLATFORM = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  })
}

describe('native screenshot backend selection', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    setPlatform(ORIGINAL_PLATFORM)
    vi.doUnmock('./native-screenshot-mac')
    vi.restoreAllMocks()
  })

  it('resolves darwin backend to mac implementation', async () => {
    const { resolveDesktopCaptureBackend } = await import('./native-screenshot')
    const { captureDesktopMacOS } = await import('./native-screenshot-mac')

    expect(resolveDesktopCaptureBackend('darwin')).toBe(captureDesktopMacOS)
  })

  it('throws explicit backend_unavailable error for unsupported platforms', async () => {
    const { resolveDesktopCaptureBackend } = await import('./native-screenshot')

    expect(() => resolveDesktopCaptureBackend('win32')).toThrow(
      '[NativeScreenshot:backend_unavailable]',
    )
    expect(() => resolveDesktopCaptureBackend('win32')).toThrow('"win32"')
  })

  it('keeps captureDesktop contract stable while delegating to selected backend', async () => {
    setPlatform('darwin')

    const mockedResult: DesktopCaptureResult = {
      filepath: 'C:\\tmp\\frame.png',
      width: 1920,
      height: 1080,
      displayId: 7,
    }
    const captureDesktopMacOSMock = vi.fn().mockResolvedValue(mockedResult)
    vi.doMock('./native-screenshot-mac', () => ({
      captureDesktopMacOS: captureDesktopMacOSMock,
    }))

    const { captureDesktop } = await import('./native-screenshot')
    const outputPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ml-capture-')),
      'a',
      'b.png',
    )

    const result = await captureDesktop({
      outputPath,
      displayId: 7,
      maxDimensionPx: 1920,
    })

    expect(captureDesktopMacOSMock).toHaveBeenCalledWith({
      outputPath,
      displayId: 7,
      maxDimensionPx: 1920,
    })
    expect(result).toEqual(mockedResult)
    expect(fs.existsSync(path.dirname(outputPath))).toBe(true)
  })
})
