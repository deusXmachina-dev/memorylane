import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import sharp from 'sharp'
import type { CaptureBackend, CaptureResult } from './capture-backend'
import { ScreenshotStream, getExecutable } from './screenshot-native'
import log from '../logger'

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
   * Capture a window by title using the native Swift binary.
   * Single-shot spawn (not the streaming process) with --window-title flag.
   * Uses CGWindowListCreateImage for direct window capture.
   */
  async captureWindow(title: string, outputPath: string): Promise<CaptureResult | null> {
    const { command, args } = getExecutable()
    const execArgs = [...args, outputPath, '--window-title', title]

    return new Promise((resolve, reject) => {
      const proc = spawn(command, execArgs)
      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })
      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        try {
          const result = JSON.parse(stdout.trim())
          if (result.error) {
            log.info(`[Capture] Window not found: "${title}" (${result.error})`)
            return resolve(null)
          }
          resolve({
            width: result.width,
            height: result.height,
            displayId: 0,
          })
        } catch {
          if (code !== 0) {
            log.error(
              `[Capture] Window capture failed (code ${code}): ${stderr.trim() || stdout.trim()}`,
            )
            return resolve(null)
          }
          reject(new Error(`Failed to parse window capture result: ${stdout.trim()}`))
        }
      })

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn window capture process: ${err.message}`))
      })
    })
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
