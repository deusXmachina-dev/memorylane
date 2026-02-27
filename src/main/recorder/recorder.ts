import { app, desktopCapturer, nativeImage } from 'electron'
// eslint-disable-next-line import/no-unresolved
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { ActivityScreenshot } from '../../shared/types'
import * as visualDetector from './visual-detector'
import * as interactionMonitor from './interaction-monitor'
import log from '../logger'

const execFileAsync = promisify(execFile)

// Configuration
const SCREENSHOTS_DIR = path.join(app.getPath('userData'), 'screenshots')

// State
let isCapturing = false

// Ensure screenshots directory exists
function ensureScreenshotsDir(): void {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })
  }
}

const FULL_RES_SIZE = { width: 1920 * 2, height: 1080 * 2 }
const SAMPLE_SIZE = { width: 320, height: 180 }

function parseDisplayId(sourceId: string): number {
  return parseInt(sourceId.split(':')[1] || '0', 10)
}

// ---------------------------------------------------------------------------
// macOS native screen capture (uses ScreenCaptureKit via screencapture CLI)
//
// Electron's desktopCapturer.getSources() returns empty thumbnails on macOS 26+
// when the app runs as an accessory (dock hidden). The system `screencapture`
// tool works reliably because it uses ScreenCaptureKit internally.
// ---------------------------------------------------------------------------

/**
 * Capture the screen to a PNG file using macOS `screencapture`.
 */
async function screencaptureToPng(filepath: string): Promise<void> {
  await execFileAsync('/usr/sbin/screencapture', ['-x', '-t', 'png', filepath])
}

/**
 * Capture a screenshot and return it as an ActivityScreenshot (macOS path).
 */
async function captureImmediateMacOS(
  trigger: ActivityScreenshot['trigger'],
  displayId?: number,
): Promise<ActivityScreenshot> {
  ensureScreenshotsDir()

  const id = uuidv4()
  const timestamp = Date.now()
  const filename = `${timestamp}_${id}.png`
  const filepath = path.join(SCREENSHOTS_DIR, filename)

  await screencaptureToPng(filepath)

  const img = nativeImage.createFromPath(filepath)
  if (img.isEmpty()) {
    fs.unlinkSync(filepath)
    throw new Error('screencapture produced an empty image')
  }
  const size = img.getSize()

  log.info(`[Capture] Screenshot saved: ${path.basename(filepath)} (trigger: ${trigger})`)

  return {
    id,
    filepath,
    timestamp,
    trigger,
    display: { id: displayId ?? 0, width: size.width, height: size.height },
  }
}

/**
 * Capture a low-res sample bitmap for visual change detection (macOS path).
 */
async function captureSampleBitmapMacOS(): Promise<Buffer> {
  ensureScreenshotsDir()
  const tmpPath = path.join(SCREENSHOTS_DIR, `_sample_${Date.now()}.png`)
  try {
    await screencaptureToPng(tmpPath)
    const img = nativeImage.createFromPath(tmpPath)
    if (img.isEmpty()) {
      throw new Error('screencapture produced an empty sample image')
    }
    const resized = img.resize({ width: SAMPLE_SIZE.width, height: SAMPLE_SIZE.height })
    return resized.toBitmap()
  } finally {
    try {
      fs.unlinkSync(tmpPath)
    } catch {
      // best-effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// desktopCapturer path (non-macOS fallback)
// ---------------------------------------------------------------------------

/**
 * Persist a captured source's thumbnail to disk and build the ActivityScreenshot metadata.
 */
function saveScreenshot(
  source: Electron.DesktopCapturerSource,
  trigger: ActivityScreenshot['trigger'],
): ActivityScreenshot {
  ensureScreenshotsDir()

  if (source.thumbnail.isEmpty()) {
    throw new Error(`Empty thumbnail for source "${source.name}" (trigger: ${trigger})`)
  }

  const id = uuidv4()
  const timestamp = Date.now()
  const filename = `${timestamp}_${id}.png`
  const filepath = path.join(SCREENSHOTS_DIR, filename)
  const size = source.thumbnail.getSize()

  fs.writeFileSync(filepath, source.thumbnail.toPNG())

  return {
    id,
    filepath,
    timestamp,
    trigger,
    display: { id: parseDisplayId(source.id), width: size.width, height: size.height },
  }
}

/**
 * Capture a screen source at the given thumbnail resolution.
 * When displayId is provided, captures the matching display; otherwise falls back to the
 * first available source (primary display).
 */
async function captureScreen(
  thumbnailSize: { width: number; height: number },
  displayId?: number,
): Promise<Electron.DesktopCapturerSource> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize,
  })

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

/**
 * Capture a low-resolution sample bitmap for visual change detection.
 * Uses a dedicated capture at SAMPLE_SIZE so the bitmap dimensions are consistent
 * (desktopCapturer treats thumbnailSize as a bounding box, not an exact size).
 */
async function captureSampleBitmap(displayId?: number): Promise<Buffer> {
  if (process.platform === 'darwin') {
    return captureSampleBitmapMacOS()
  }
  const source = await captureScreen(SAMPLE_SIZE, displayId)
  return source.thumbnail.toBitmap()
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture a screenshot immediately.
 * Used by ActivityManager for on-demand captures (activity start/end/periodic).
 */
export async function captureImmediate(
  trigger: ActivityScreenshot['trigger'],
  displayId?: number,
): Promise<ActivityScreenshot> {
  if (process.platform === 'darwin') {
    return captureImmediateMacOS(trigger, displayId)
  }

  const source = await captureScreen(FULL_RES_SIZE, displayId)
  const screenshot = saveScreenshot(source, trigger)
  log.info(
    `[Capture] Screenshot saved: ${path.basename(screenshot.filepath)} (trigger: ${trigger})`,
  )
  return screenshot
}

/**
 * Check for visual change and capture if detected.
 * Used by ActivityManager for periodic visual-change-gated captures.
 * Returns the screenshot if visual change was detected, null otherwise.
 */
export async function captureIfVisualChange(
  trigger: ActivityScreenshot['trigger'],
  displayId?: number,
): Promise<ActivityScreenshot | null> {
  const sampleBitmap = await captureSampleBitmap(displayId)
  const result = visualDetector.checkBitmapAgainstBaseline(sampleBitmap)

  if (!result.changed) {
    return null
  }

  log.info(
    `[Capture] Visual change detected (${result.difference.toFixed(1)}%) - capturing screenshot`,
  )

  const screenshot = await captureImmediate(trigger, displayId)
  visualDetector.updateBaselineFromBitmap(sampleBitmap)
  return screenshot
}

/**
 * Capture a specific window by its title.
 * Uses desktopCapturer with types: ['window'] which on macOS uses CGWindowListCopyWindowInfo,
 * allowing capture of background windows regardless of z-order.
 * Returns null if no window with the given title is found or if the thumbnail is empty.
 */
export async function captureWindowByTitle(
  title: string,
  trigger: ActivityScreenshot['trigger'],
): Promise<ActivityScreenshot | null> {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: FULL_RES_SIZE,
  })

  log.debug(
    `[Capture] captureWindowByTitle: looking for "${title}" among ${sources.length} windows: [${sources.map((s) => `"${s.name}"`).join(', ')}]`,
  )

  const source = sources.find((s) => s.name === title)
  if (!source) {
    log.info(
      `[Capture] Window not found by title: "${title}" (${sources.length} windows available)`,
    )
    return null
  }

  if (source.thumbnail.isEmpty()) {
    log.info(`[Capture] Window thumbnail is empty for "${title}", skipping`)
    return null
  }

  const screenshot = saveScreenshot(source, trigger)
  log.info(
    `[Capture] Window screenshot saved: ${path.basename(screenshot.filepath)} ` +
      `(title: "${title}", trigger: ${trigger})`,
  )
  return screenshot
}

/**
 * Start the capture system: visual detection and interaction monitoring.
 * The ActivityManager (wired in index.ts) handles interaction routing and capture orchestration.
 */
export function startCapture(): void {
  if (isCapturing) {
    log.info('[Capture] Already running')
    return
  }

  log.info('[Capture] Starting capture system')
  isCapturing = true

  // Start visual detection (enables the module for baseline comparisons)
  visualDetector.startVisualDetection()

  // Start interaction monitoring (events routed to ActivityManager via index.ts)
  interactionMonitor.startInteractionMonitoring()

  // Initialize visual detection baseline from a sample capture
  captureSampleBitmap()
    .then((sampleBitmap) => {
      visualDetector.updateBaselineFromBitmap(sampleBitmap)
      log.info('[Capture] Visual detection baseline initialized')
    })
    .catch((error) => {
      log.error('[Capture] Failed to initialize baseline:', error)
    })
}

/**
 * Stop the capture system.
 */
export function stopCapture(): void {
  if (!isCapturing) {
    log.info('[Capture] Not running')
    return
  }

  log.info('[Capture] Stopping capture system')
  isCapturing = false

  // Stop visual detection
  visualDetector.stopVisualDetection()

  // Stop interaction monitoring
  interactionMonitor.stopInteractionMonitoring()
}

/**
 * Get the directory where screenshots are saved
 */
export function getScreenshotsDir(): string {
  return SCREENSHOTS_DIR
}

/**
 * Check if capture is currently running
 */
export function isCapturingNow(): boolean {
  return isCapturing
}
