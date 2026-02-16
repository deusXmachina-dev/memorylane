import { app, desktopCapturer } from 'electron'
// eslint-disable-next-line import/no-unresolved
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import * as path from 'path'
import {
  Screenshot,
  OnScreenshotCallback,
  SessionAppIdentity,
  CaptureReason,
  InteractionContext,
} from '../../shared/types'
import { CAPTURE_RATE_CONFIG } from '@constants'
import * as visualDetector from './visual-detector'
import * as interactionMonitor from './interaction-monitor'
import log from '../logger'

// Configuration
const SCREENSHOTS_DIR = path.join(app.getPath('userData'), 'screenshots')
const SCREENSHOT_MAX_AGE_MS = 60_000
const CLEANUP_INTERVAL_MS = 30_000

// State
const screenshotCallbacks: OnScreenshotCallback[] = []
let isCapturing = false
let cleanupTimer: ReturnType<typeof setInterval> | null = null
let lastCaptureTime = 0
let isProcessingInteraction = false
let sessionMaxDurationTimeout: ReturnType<typeof setTimeout> | null = null
let currentSession: RecorderSession | null = null

interface RecorderSession {
  sessionId: string
  appIdentity: SessionAppIdentity | null
  displayId: number | undefined
  startTimestamp: number
  screenshots: Screenshot[]
  interactionEvents: InteractionContext[]
  closed: boolean
}

function getAppNameFromIdentity(identity: SessionAppIdentity | null): string {
  return identity?.processName ?? ''
}

function clearSessionTimer(): void {
  if (sessionMaxDurationTimeout) {
    clearTimeout(sessionMaxDurationTimeout)
    sessionMaxDurationTimeout = null
  }
}

function scheduleSessionTimeout(sessionId: string): void {
  clearSessionTimer()
  sessionMaxDurationTimeout = setTimeout(() => {
    if (!isCapturing || !currentSession || currentSession.sessionId !== sessionId) {
      return
    }

    log.info(`[Session] Max duration reached for session ${sessionId}`)
  }, CAPTURE_RATE_CONFIG.MAX_SESSION_DURATION_MS)
}

function startSession(appIdentity: SessionAppIdentity | null, displayId: number | undefined): void {
  const sessionId = uuidv4()

  currentSession = {
    sessionId,
    appIdentity,
    displayId,
    startTimestamp: Date.now(),
    screenshots: [],
    interactionEvents: [],
    closed: false,
  }

  scheduleSessionTimeout(sessionId)
  log.info(
    `[Session] Started ${sessionId} for app "${getAppNameFromIdentity(appIdentity)}" (display: ${displayId ?? 'unknown'})`,
  )
}

function ensureSessionForInteraction(context: InteractionContext): void {
  if (currentSession) {
    return
  }

  startSession(context.activeWindow ?? null, context.displayId)
}

function addInteractionToSession(context: InteractionContext): void {
  ensureSessionForInteraction(context)
  currentSession?.interactionEvents.push(context)
}

function addScreenshotToSession(screenshot: Screenshot): void {
  if (!currentSession) {
    startSession(null, screenshot.display.id)
  }
  currentSession?.screenshots.push(screenshot)
}

// Ensure screenshots directory exists
function ensureScreenshotsDir(): void {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })
  }
}

/**
 * Delete screenshot files older than SCREENSHOT_MAX_AGE_MS from the screenshots directory.
 */
function cleanupOldScreenshots(): void {
  try {
    const now = Date.now()
    const files = fs.readdirSync(SCREENSHOTS_DIR)

    for (const file of files) {
      if (!file.endsWith('.png')) continue

      const filepath = path.join(SCREENSHOTS_DIR, file)
      const stat = fs.statSync(filepath)

      if (now - stat.mtimeMs > SCREENSHOT_MAX_AGE_MS) {
        fs.unlinkSync(filepath)
        log.info(`[Cleanup] Deleted old screenshot: ${file}`)
      }
    }
  } catch (error) {
    log.error('[Cleanup] Error cleaning up old screenshots:', error)
  }
}

const FULL_RES_SIZE = { width: 1920 * 2, height: 1080 * 2 }
const SAMPLE_SIZE = { width: 320, height: 180 }

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
  const source = await captureScreen(SAMPLE_SIZE, displayId)
  return source.thumbnail.toBitmap()
}

/**
 * Handle an interaction event by checking for visual changes and capturing if needed.
 */
async function handleInteraction(context: InteractionContext): Promise<void> {
  addInteractionToSession(context)

  const now = Date.now()
  const timeSinceLastCapture = now - lastCaptureTime

  if (timeSinceLastCapture < CAPTURE_RATE_CONFIG.MIN_CAPTURE_INTERVAL_MS) {
    log.info(
      `[Capture] Interaction skipped (cooldown: ${timeSinceLastCapture}ms < ${CAPTURE_RATE_CONFIG.MIN_CAPTURE_INTERVAL_MS}ms)`,
    )
    return
  }

  if (isProcessingInteraction) {
    log.info('[Capture] Interaction skipped (already processing)')
    return
  }

  isProcessingInteraction = true

  try {
    log.info(
      `[Capture] Interaction detected: ${context.type} (display: ${context.displayId ?? 'unknown'})`,
    )

    const sampleBitmap = await captureSampleBitmap(context.displayId)
    const result = visualDetector.checkBitmapAgainstBaseline(sampleBitmap)

    if (result.changed) {
      log.info(
        `[Capture] Visual change detected (${result.difference.toFixed(1)}%) - capturing full-res screenshot`,
      )

      const fullSource = await captureScreen(FULL_RES_SIZE, context.displayId)
      saveScreenshotFromSource(fullSource, {
        type: 'baseline_change',
        confidence: result.difference,
      })

      lastCaptureTime = Date.now()

      visualDetector.updateBaselineFromBitmap(sampleBitmap)
      log.info('[Capture] Baseline updated to new screenshot')
    } else {
      log.info(
        `[Capture] No significant change (${result.difference.toFixed(1)}%) - keeping current baseline`,
      )
    }
  } finally {
    isProcessingInteraction = false
  }
}

/**
 * Save a screenshot from an already-captured source, notify callbacks, and return metadata.
 */
function saveScreenshotFromSource(
  source: Electron.DesktopCapturerSource,
  reason: CaptureReason,
): Screenshot {
  ensureScreenshotsDir()

  const thumbnail = source.thumbnail
  const id = uuidv4()
  const timestamp = Date.now()
  const filename = `${timestamp}_${id}.png`
  const filepath = path.join(SCREENSHOTS_DIR, filename)
  const size = thumbnail.getSize()

  const pngBuffer = thumbnail.toPNG()
  fs.writeFileSync(filepath, pngBuffer)

  const screenshot: Screenshot = {
    id,
    filepath,
    timestamp,
    display: {
      id: parseInt(source.id.split(':')[1] || '0', 10),
      width: size.width,
      height: size.height,
    },
    trigger: reason,
  }

  addScreenshotToSession(screenshot)

  log.info(`[Capture] Screenshot saved: ${filename} (reason: ${reason.type})`)
  log.debug(
    `[Capture] Screenshot details: display=${screenshot.display.id}, ` +
      `size=${size.width}x${size.height}, source=${source.id}`,
  )

  screenshotCallbacks.forEach((callback) => {
    try {
      callback(screenshot)
    } catch (error) {
      log.error('Error in screenshot callback:', error)
    }
  })

  return screenshot
}

/**
 * Start capturing screenshots using event-driven baseline detection
 */
export function startCapture(): void {
  if (isCapturing) {
    log.info('[Capture] Already running')
    return
  }

  log.info('[Capture] Starting screenshot capture with event-driven baseline detection')
  isCapturing = true
  startSession(null, undefined)

  // Start periodic cleanup of old screenshot files
  cleanupTimer = setInterval(cleanupOldScreenshots, CLEANUP_INTERVAL_MS)

  // Start visual detection (no interval, just enables the module)
  visualDetector.startVisualDetection()

  // Start interaction monitoring
  interactionMonitor.startInteractionMonitoring()

  // Capture initial baseline screenshot and derive baseline from a separate sample capture
  Promise.all([captureScreen(FULL_RES_SIZE), captureSampleBitmap()])
    .then(([fullSource, sampleBitmap]) => {
      visualDetector.updateBaselineFromBitmap(sampleBitmap)

      saveScreenshotFromSource(fullSource, { type: 'manual' })
      log.info('[Capture] Initial baseline screenshot captured')
    })
    .catch((error) => {
      log.error('[Capture] Failed to capture initial baseline:', error)
    })

  // Register interaction monitor callback
  interactionMonitor.onInteraction(handleInteraction)
}

/**
 * Stop capturing screenshots
 */
export function stopCapture(): void {
  if (!isCapturing) {
    log.info('[Capture] Not running')
    return
  }

  log.info('[Capture] Stopping screenshot capture')
  isCapturing = false
  lastCaptureTime = 0
  isProcessingInteraction = false
  clearSessionTimer()
  currentSession = null

  // Stop periodic cleanup
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }

  // Stop visual detection
  visualDetector.stopVisualDetection()

  // Clear interaction monitor callbacks
  interactionMonitor.clearInteractionCallback(handleInteraction)

  // Stop interaction monitoring
  interactionMonitor.stopInteractionMonitoring()
}

/**
 * Register a callback to be notified when screenshots are captured
 */
export function onScreenshot(callback: OnScreenshotCallback): void {
  screenshotCallbacks.push(callback)
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
