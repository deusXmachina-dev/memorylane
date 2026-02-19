import { desktopCapturer } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import sharp from 'sharp'
import type { CaptureBackend, CaptureResult } from './capture-backend'
import { ScreenshotStream } from './screenshot-native'
import log from '../logger'

const FULL_RES_SIZE = { width: 1920, height: 1080 }
const SAMPLE_SIZE = { width: 320, height: 180 }

export class NativeCaptureBackend implements CaptureBackend {
  private stream: ScreenshotStream | null = null

  async captureScreen(outputPath: string, displayId?: number): Promise<CaptureResult> {
    this.ensureStream(displayId)

    const result = await this.stream!.capture(outputPath)

    return {
      width: result.width,
      height: result.height,
      displayId: displayId ?? 0,
    }
  }

  async captureSampleBitmap(displayId?: number): Promise<Buffer> {
    this.ensureStream(displayId)

    const tmpPath = path.join(os.tmpdir(), `ml-sample-${Date.now()}.png`)
    try {
      await this.stream!.capture(tmpPath)

      const bitmap = await sharp(tmpPath)
        .resize(SAMPLE_SIZE.width, SAMPLE_SIZE.height)
        .ensureAlpha()
        .raw()
        .toBuffer()

      return bitmap
    } finally {
      fs.promises.unlink(tmpPath).catch(() => {})
    }
  }

  /**
   * Capture a window by title using Electron's desktopCapturer.
   * Window capture is infrequent (app-switch only) and desktopCapturer
   * has the TCC Screen Recording permission needed for window name access,
   * which standalone binaries don't inherit.
   */
  async captureWindow(title: string, outputPath: string): Promise<CaptureResult | null> {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: FULL_RES_SIZE,
    })

    log.debug(
      `[Capture] captureWindow: looking for "${title}" among ${sources.length} windows: [${sources.map((s) => `"${s.name}"`).join(', ')}]`,
    )

    const source = sources.find((s) => s.name === title)
    if (!source) {
      log.info(
        `[Capture] Window not found by title: "${title}" (${sources.length} windows available)`,
      )
      return null
    }

    const size = source.thumbnail.getSize()
    fs.writeFileSync(outputPath, source.thumbnail.toPNG())

    return {
      width: size.width,
      height: size.height,
      displayId: parseInt(source.id.split(':')[1] || '0', 10),
    }
  }

  start(): void {
    if (!this.stream) {
      this.stream = new ScreenshotStream({ format: 'png' })
      this.stream.start()
      log.info('[Capture] Native capture backend started')
    }
  }

  stop(): void {
    if (this.stream) {
      this.stream.stop()
      this.stream = null
      log.info('[Capture] Native capture backend stopped')
    }
  }

  private ensureStream(displayId?: number): void {
    if (!this.stream) {
      this.stream = new ScreenshotStream({
        format: 'png',
        ...(displayId !== undefined ? { displayId } : {}),
      })
      this.stream.start()
    }
  }
}
