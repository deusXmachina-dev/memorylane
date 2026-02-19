import { app } from 'electron'
// eslint-disable-next-line import/no-unresolved
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import * as path from 'path'
import { ActivityScreenshot } from '../../shared/types'
import { createCaptureBackend, CaptureBackend } from './capture-backend'
import * as visualDetector from './visual-detector'
import * as interactionMonitor from './interaction-monitor'
import log from '../logger'

// Configuration
const SCREENSHOTS_DIR = path.join(app.getPath('userData'), 'screenshots')

// State
let isCapturing = false
let backend: CaptureBackend | null = null

// Ensure screenshots directory exists
function ensureScreenshotsDir(): void {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })
  }
}

function getBackend(): CaptureBackend {
  if (!backend) {
    backend = createCaptureBackend()
  }
  return backend
}

/**
 * Capture a screenshot immediately.
 * Used by ActivityManager for on-demand captures (activity start/end/periodic).
 */
export async function captureImmediate(
  trigger: ActivityScreenshot['trigger'],
  displayId?: number,
): Promise<ActivityScreenshot> {
  ensureScreenshotsDir()

  const id = uuidv4()
  const timestamp = Date.now()
  const filename = `${timestamp}_${id}.png`
  const filepath = path.join(SCREENSHOTS_DIR, filename)

  const result = await getBackend().captureScreen(filepath, displayId)

  const screenshot: ActivityScreenshot = {
    id,
    filepath,
    timestamp,
    trigger,
    display: { id: result.displayId, width: result.width, height: result.height },
  }

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
  const sampleBitmap = await getBackend().captureSampleBitmap(displayId)
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
 * Uses native window capture on macOS (CGWindowListCreateImage),
 * desktopCapturer on other platforms. Returns null if window not found.
 */
export async function captureWindowByTitle(
  title: string,
  trigger: ActivityScreenshot['trigger'],
): Promise<ActivityScreenshot | null> {
  ensureScreenshotsDir()

  const id = uuidv4()
  const timestamp = Date.now()
  const filename = `${timestamp}_${id}.png`
  const filepath = path.join(SCREENSHOTS_DIR, filename)

  const result = await getBackend().captureWindow(title, filepath)
  if (!result) {
    // Clean up file if it was partially written
    fs.promises.unlink(filepath).catch(() => {})
    return null
  }

  const screenshot: ActivityScreenshot = {
    id,
    filepath,
    timestamp,
    trigger,
    display: { id: result.displayId, width: result.width, height: result.height },
  }

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

  // Start the capture backend (starts native process on macOS)
  getBackend().start()

  // Start visual detection (enables the module for baseline comparisons)
  visualDetector.startVisualDetection()

  // Start interaction monitoring (events routed to ActivityManager via index.ts)
  interactionMonitor.startInteractionMonitoring()

  // Initialize visual detection baseline from a sample capture
  getBackend()
    .captureSampleBitmap()
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

  // Stop the capture backend (stops native process on macOS)
  getBackend().stop()
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
