import { desktopCapturer } from 'electron'
import log from '../logger'

/**
 * Minimal interface for a window source, matching the subset of
 * Electron.DesktopCapturerSource that we use. Defined here so tests
 * can provide lightweight mocks without depending on the full Electron type.
 */
export interface WindowSource {
  id: string
  name: string
  thumbnail: {
    getSize(): { width: number; height: number }
    toPNG(): Buffer
  }
}

export interface CaptureWindowResult {
  /** PNG image data */
  image: Buffer
  /** desktopCapturer source ID (e.g. "window:12345:0") */
  sourceId: string
  /** Matched window title */
  title: string
  /** Captured image width in pixels */
  width: number
  /** Captured image height in pixels */
  height: number
}

export interface CaptureWindowOptions {
  /**
   * Window title to match (case-insensitive substring).
   * If omitted, captures the frontmost window.
   */
  title?: string
  /**
   * Thumbnail size bounding box for the capture.
   * Defaults to 3840x2160 (2x 1920x1080).
   */
  thumbnailSize?: { width: number; height: number }
}

const DEFAULT_THUMBNAIL_SIZE = { width: 1920 * 2, height: 1080 * 2 }

/** Function signature for retrieving window sources. Injectable for testing. */
export type GetWindowSourcesFn = (opts: {
  types: string[]
  thumbnailSize: { width: number; height: number }
}) => Promise<WindowSource[]>

/**
 * Find the best matching window source from a list of sources.
 *
 * If `title` is provided, returns the first source whose name contains the
 * substring (case-insensitive). Otherwise returns the first source (frontmost window).
 *
 * Exported separately so the matching logic can be unit-tested without mocking captures.
 */
export function findMatchingSource(sources: WindowSource[], title?: string): WindowSource | null {
  if (sources.length === 0) return null
  if (!title) return sources[0]

  const lower = title.toLowerCase()
  return sources.find((s) => s.name.toLowerCase().includes(lower)) ?? null
}

/**
 * Capture a window screenshot.
 *
 * If `title` is provided in options, finds the first window whose title
 * contains the given substring (case-insensitive). Otherwise captures the
 * frontmost window (first in the desktopCapturer list).
 *
 * Returns null if no matching window is found.
 *
 * @param options - Capture options (title filter, thumbnail size)
 * @param getSources - Source provider function; defaults to desktopCapturer.getSources.
 *                     Pass a custom function in tests to avoid Electron dependency.
 */
export async function captureWindow(
  options: CaptureWindowOptions = {},
  getSources: GetWindowSourcesFn = desktopCapturer.getSources.bind(desktopCapturer),
): Promise<CaptureWindowResult | null> {
  const { title, thumbnailSize = DEFAULT_THUMBNAIL_SIZE } = options

  const sources = await getSources({
    types: ['window'],
    thumbnailSize,
  })

  const source = findMatchingSource(sources, title)

  if (!source) {
    log.warn(
      `[WindowCapture] No window${title ? ` matching "${title}"` : ''} found. ` +
        `Available: [${sources.map((s) => `"${s.name}"`).join(', ')}]`,
    )
    return null
  }

  const size = source.thumbnail.getSize()
  const image = source.thumbnail.toPNG()

  log.info(
    `[WindowCapture] Captured window "${source.name}" (${size.width}x${size.height}, ${image.length} bytes)`,
  )

  return {
    image,
    sourceId: source.id,
    title: source.name,
    width: size.width,
    height: size.height,
  }
}
