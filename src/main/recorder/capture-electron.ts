import { desktopCapturer } from 'electron'
import * as fs from 'fs'
import type { CaptureBackend, CaptureResult } from './capture-backend'
import log from '../logger'

const FULL_RES_SIZE = { width: 1920, height: 1080 }
const SAMPLE_SIZE = { width: 320, height: 180 }

function parseDisplayId(sourceId: string): number {
  return parseInt(sourceId.split(':')[1] || '0', 10)
}

async function getScreenSource(
  thumbnailSize: { width: number; height: number },
  displayId?: number,
): Promise<Electron.DesktopCapturerSource> {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })

  const source =
    (displayId !== undefined
      ? sources.find((s) => s.display_id === String(displayId))
      : undefined) ?? sources[0]

  if (source === undefined) {
    throw new Error('No screen sources available')
  }

  log.debug(
    `[Capture] captureScreen: requested display=${displayId ?? 'any'}, ` +
      `matched source=${source.id} (display_id=${source.display_id}), ` +
      `available sources=[${sources.map((s) => s.display_id).join(', ')}]`,
  )

  return source
}

export class ElectronCaptureBackend implements CaptureBackend {
  async captureScreen(outputPath: string, displayId?: number): Promise<CaptureResult> {
    const source = await getScreenSource(FULL_RES_SIZE, displayId)
    const size = source.thumbnail.getSize()

    fs.writeFileSync(outputPath, source.thumbnail.toPNG())

    return {
      width: size.width,
      height: size.height,
      displayId: parseDisplayId(source.id),
    }
  }

  async captureSampleBitmap(displayId?: number): Promise<Buffer> {
    const source = await getScreenSource(SAMPLE_SIZE, displayId)
    return source.thumbnail.toBitmap()
  }

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
      displayId: parseDisplayId(source.id),
    }
  }

  start(): void {
    // desktopCapturer needs no lifecycle management
  }

  stop(): void {
    // desktopCapturer needs no lifecycle management
  }
}
