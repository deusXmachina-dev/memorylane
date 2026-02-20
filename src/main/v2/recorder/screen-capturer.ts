import * as path from 'path'
import log from '../../logger'
import { SCREEN_CAPTURER_CONFIG } from '@constants'
import { captureDesktop } from './native-screenshot'
import type { DurableStream } from '../streams/stream'

export interface ScreenCapturerConfig {
  intervalMs?: number
  outputDir: string
  displayId?: number
  maxDimensionPx?: number
  stream: DurableStream<Frame>
}

export interface Frame {
  filepath: string
  timestamp: number
  width: number
  height: number
  displayId: number
  sequenceNumber: number
}

export class ScreenCapturer {
  private readonly intervalMs: number
  private readonly outputDir: string
  private displayId: number | undefined
  private readonly maxDimensionPx: number | undefined
  private readonly stream: DurableStream<Frame>
  private _capturing = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private _sequenceNumber = 0
  private appendChain: Promise<void> = Promise.resolve()

  constructor(config: ScreenCapturerConfig) {
    this.intervalMs = config.intervalMs ?? SCREEN_CAPTURER_CONFIG.DEFAULT_INTERVAL_MS
    this.outputDir = config.outputDir
    this.displayId = config.displayId
    this.maxDimensionPx = config.maxDimensionPx ?? SCREEN_CAPTURER_CONFIG.MAX_DIMENSION_PX
    this.stream = config.stream
  }

  get capturing(): boolean {
    return this._capturing
  }

  setDisplayId(displayId: number | undefined): void {
    this.displayId = displayId
  }

  start(): void {
    if (this._capturing) return
    this._capturing = true
    this.tick()
  }

  stop(): void {
    this._capturing = false
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private tick(): void {
    if (!this._capturing) return

    const start = Date.now()
    this.captureFrame()
      .then(() => {
        if (!this._capturing) return
        const elapsed = Date.now() - start
        const delay = Math.max(0, this.intervalMs - elapsed)
        this.timer = setTimeout(() => this.tick(), delay)
      })
      .catch((err) => {
        log.error('[ScreenCapturer] Capture failed:', err)
        if (!this._capturing) return
        const elapsed = Date.now() - start
        const delay = Math.max(0, this.intervalMs - elapsed)
        this.timer = setTimeout(() => this.tick(), delay)
      })
  }

  private async captureFrame(): Promise<void> {
    const seq = this._sequenceNumber++
    const outputPath = path.join(this.outputDir, `frame-${seq}.png`)
    const timestamp = Date.now()

    const result = await captureDesktop({
      outputPath,
      displayId: this.displayId,
      maxDimensionPx: this.maxDimensionPx,
    })

    const frame: Frame = {
      filepath: result.filepath,
      timestamp,
      width: result.width,
      height: result.height,
      displayId: result.displayId,
      sequenceNumber: seq,
    }

    this.enqueueFrame(frame)
  }

  private enqueueFrame(frame: Frame): void {
    const appendTask = this.appendChain.then(() => this.stream.append(frame))

    this.appendChain = appendTask
      .then(() => undefined)
      .catch((err) => {
        log.error('[ScreenCapturer] Stream append failed:', err)
      })
  }
}
