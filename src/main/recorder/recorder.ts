import { app, desktopCapturer } from 'electron'
// eslint-disable-next-line import/no-unresolved
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import * as path from 'path'
import { ActivityScreenshot } from '../../shared/types'
import * as interactionMonitor from './interaction-monitor'
import log from '../logger'

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

const FULL_RES_SIZE = { width: 1920, height: 1080 }

function parseDisplayId(sourceId: string): number {
  return parseInt(sourceId.split(':')[1] || '0', 10)
}

/**
 * Persist a captured source's thumbnail to disk and build the ActivityScreenshot metadata.
 */
function saveScreenshot(
  source: Electron.DesktopCapturerSource,
  trigger: ActivityScreenshot['trigger'],
): ActivityScreenshot {
  ensureScreenshotsDir()

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
 * Capture a screenshot immediately.
 * Used by ActivityManager for on-demand captures (activity start/end/periodic).
 */
export async function captureImmediate(
  trigger: ActivityScreenshot['trigger'],
  displayId?: number,
): Promise<ActivityScreenshot> {
  const source = await captureScreen(FULL_RES_SIZE, displayId)
  const screenshot = saveScreenshot(source, trigger)
  log.info(
    `[Capture] Screenshot saved: ${path.basename(screenshot.filepath)} (trigger: ${trigger})`,
  )
  return screenshot
}

/**
 * Capture a specific window by its title.
 * Uses desktopCapturer with types: ['window'] which on macOS uses CGWindowListCopyWindowInfo,
 * allowing capture of background windows regardless of z-order.
 * Returns null if no window with the given title is found.
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

  const screenshot = saveScreenshot(source, trigger)
  log.info(
    `[Capture] Window screenshot saved: ${path.basename(screenshot.filepath)} ` +
      `(title: "${title}", trigger: ${trigger})`,
  )
  return screenshot
}

/**
 * Start the capture system.
 * The ActivityManager (wired in index.ts) handles interaction routing and capture orchestration.
 */
export function startCapture(): void {
  if (isCapturing) {
    log.info('[Capture] Already running')
    return
  }

  log.info('[Capture] Starting capture system')
  isCapturing = true

  // Start interaction monitoring (events routed to ActivityManager via index.ts)
  interactionMonitor.startInteractionMonitoring()
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
