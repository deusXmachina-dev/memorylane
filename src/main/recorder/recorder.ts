import { app, desktopCapturer } from 'electron'
// eslint-disable-next-line import/no-unresolved
import { v4 as uuidv4 } from 'uuid'
import * as fs from 'fs'
import * as path from 'path'
import {
  Screenshot,
  OnScreenshotCallback,
  OnSessionCompleteCallback,
  CompletedAppSession,
  SessionAppIdentity,
  SessionEndReason,
  CaptureReason,
  InteractionContext,
} from '../../shared/types'
import { CAPTURE_RATE_CONFIG } from '@constants'
import * as visualDetector from './visual-detector'
import * as interactionMonitor from './interaction-monitor'
import log from '../logger'

const SCREENSHOTS_DIR = path.join(app.getPath('userData'), 'screenshots')
const FULL_RES_SIZE = { width: 1920 * 2, height: 1080 * 2 }
const SAMPLE_SIZE = { width: 320, height: 180 }

const screenshotCallbacks: OnScreenshotCallback[] = []
const sessionCallbacks: OnSessionCompleteCallback[] = []

let isCapturing = false
let lastCaptureTime = 0
let isProcessingInteraction = false
let currentSession: RecorderSession | null = null
let sessionMaxDurationTimeout: ReturnType<typeof setTimeout> | null = null
let recorderWorkQueue: Promise<void> = Promise.resolve()

interface RecorderSession {
  sessionId: string
  appIdentity: SessionAppIdentity | null
  displayId: number | undefined
  startTimestamp: number
  screenshots: Screenshot[]
  interactionEvents: InteractionContext[]
  closed: boolean
}

function ensureScreenshotsDir(): void {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })
  }
}

function getAppNameFromIdentity(identity: SessionAppIdentity | null): string {
  return identity?.processName ?? ''
}

function toCompletedSession(
  session: RecorderSession,
  endReason: SessionEndReason,
  endTimestamp: number,
): CompletedAppSession {
  return {
    sessionId: session.sessionId,
    appName: getAppNameFromIdentity(session.appIdentity),
    startTimestamp: session.startTimestamp,
    endTimestamp,
    screenshots: [...session.screenshots],
    interactionEvents: [...session.interactionEvents],
    endReason,
  }
}

function emitCompletedSession(session: CompletedAppSession): void {
  sessionCallbacks.forEach((callback) => {
    try {
      callback(session)
    } catch (error) {
      log.error('Error in session callback:', error)
    }
  })
}

function clearSessionTimer(): void {
  if (sessionMaxDurationTimeout) {
    clearTimeout(sessionMaxDurationTimeout)
    sessionMaxDurationTimeout = null
  }
}

function enqueueRecorderWork(work: () => Promise<void>): void {
  recorderWorkQueue = recorderWorkQueue.then(work).catch((error) => {
    log.error('[Session] Recorder queue work failed:', error)
  })
}

function startSession(
  appIdentity: SessionAppIdentity | null,
  displayId: number | undefined,
): RecorderSession {
  const session: RecorderSession = {
    sessionId: uuidv4(),
    appIdentity,
    displayId,
    startTimestamp: Date.now(),
    screenshots: [],
    interactionEvents: [],
    closed: false,
  }

  currentSession = session
  scheduleSessionTimeout(session.sessionId)
  log.info(
    `[Session] Started ${session.sessionId} for app "${getAppNameFromIdentity(session.appIdentity)}" (display: ${displayId ?? 'unknown'})`,
  )

  return session
}

function scheduleSessionTimeout(sessionId: string): void {
  clearSessionTimer()

  sessionMaxDurationTimeout = setTimeout(() => {
    enqueueRecorderWork(async () => {
      if (!isCapturing || !currentSession || currentSession.sessionId !== sessionId) {
        return
      }

      const previousIdentity = currentSession.appIdentity
      const previousDisplayId = currentSession.displayId

      log.info(`[Session] Max duration reached for session ${sessionId}`)
      await endCurrentSession('max_duration')
      await beginSessionAndCaptureInitial(previousIdentity, previousDisplayId, 'max_duration')
    })
  }, CAPTURE_RATE_CONFIG.MAX_SESSION_DURATION_MS)
}

function getDisplayIdForContext(context: InteractionContext): number | undefined {
  return context.displayId ?? currentSession?.displayId
}

function ensureSessionForInteraction(context: InteractionContext): void {
  if (currentSession) {
    return
  }

  startSession(context.activeWindow ?? null, context.displayId)
}

function addInteractionToSession(context: InteractionContext): void {
  ensureSessionForInteraction(context)

  if (currentSession && context.displayId !== undefined) {
    currentSession.displayId = context.displayId
  }
  if (currentSession && context.activeWindow) {
    currentSession.appIdentity = {
      title: context.activeWindow.title,
      processName: context.activeWindow.processName,
    }
  }
  currentSession?.interactionEvents.push(context)
}

async function captureDisplaySource(
  thumbnailSize: { width: number; height: number },
  displayId?: number,
): Promise<Electron.DesktopCapturerSource> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize,
  })

  const source =
    (displayId !== undefined
      ? sources.find((candidate) => candidate.display_id === String(displayId))
      : undefined) ?? sources[0]

  if (source === undefined) {
    throw new Error('No screen sources available')
  }

  log.debug(
    `[Capture] captureScreen: requested display=${displayId ?? 'any'}, ` +
      `matched source=${source.id} (display_id=${source.display_id}), ` +
      `available sources=[${sources.map((candidate) => candidate.display_id).join(', ')}]`,
  )

  return source
}

async function captureWindowSource(
  thumbnailSize: { width: number; height: number },
  appIdentity: SessionAppIdentity,
): Promise<Electron.DesktopCapturerSource | null> {
  const windowSources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize,
  })

  const normalizedTitle = appIdentity.title.trim().toLowerCase()
  const normalizedProcessName = appIdentity.processName.trim().toLowerCase()

  const byExactTitle =
    normalizedTitle.length > 0
      ? windowSources.find((source) => source.name.trim().toLowerCase() === normalizedTitle)
      : undefined

  const byContainsTitle =
    normalizedTitle.length > 0
      ? windowSources.find((source) => source.name.trim().toLowerCase().includes(normalizedTitle))
      : undefined

  const byProcessName =
    normalizedProcessName.length > 0
      ? windowSources.find((source) =>
          source.name.trim().toLowerCase().includes(normalizedProcessName),
        )
      : undefined

  const source = byExactTitle ?? byContainsTitle ?? byProcessName ?? null

  if (source) {
    log.debug(
      `[Capture] captureWindowSource: matched window source=${source.id}, title="${source.name}", app=${appIdentity.processName}`,
    )
  }

  return source
}

async function capturePreferredSource(
  thumbnailSize: { width: number; height: number },
  session: RecorderSession,
): Promise<Electron.DesktopCapturerSource> {
  if (session.appIdentity) {
    try {
      const windowSource = await captureWindowSource(thumbnailSize, session.appIdentity)
      if (windowSource) {
        return windowSource
      }

      log.warn(
        `[Capture] Window capture lookup failed for app "${session.appIdentity.processName}" (title="${session.appIdentity.title}"), falling back to display capture`,
      )
    } catch (error) {
      log.warn(
        `[Capture] Window capture failed for app "${session.appIdentity.processName}", falling back to display capture`,
        error,
      )
    }
  }

  return captureDisplaySource(thumbnailSize, session.displayId)
}

async function captureSampleBitmap(session: RecorderSession): Promise<Buffer> {
  const source = await capturePreferredSource(SAMPLE_SIZE, session)
  return source.thumbnail.toBitmap()
}

function saveScreenshotFromSource(
  source: Electron.DesktopCapturerSource,
  reason: CaptureReason,
  session: RecorderSession | null,
): Screenshot {
  ensureScreenshotsDir()

  const thumbnail = source.thumbnail
  const id = uuidv4()
  const timestamp = Date.now()
  const filename = `${timestamp}_${id}.png`
  const filepath = path.join(SCREENSHOTS_DIR, filename)
  const size = thumbnail.getSize()

  fs.writeFileSync(filepath, thumbnail.toPNG())

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

  if (session) {
    session.screenshots.push(screenshot)
  }

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

async function captureInitialScreenshot(
  session: RecorderSession,
  reason: SessionEndReason | 'start',
): Promise<void> {
  const [fullSource, sampleBitmap] = await Promise.all([
    capturePreferredSource(FULL_RES_SIZE, session),
    captureSampleBitmap(session),
  ])

  visualDetector.updateBaselineFromBitmap(sampleBitmap)
  saveScreenshotFromSource(
    fullSource,
    {
      type: 'manual',
      metadata: {
        phase: 'session_start',
        reason,
      },
    },
    session,
  )
}

async function beginSessionAndCaptureInitial(
  appIdentity: SessionAppIdentity | null,
  displayId: number | undefined,
  reason: SessionEndReason | 'start',
): Promise<void> {
  let resolvedIdentity = appIdentity
  let resolvedDisplayId = displayId

  if (!resolvedIdentity || resolvedDisplayId === undefined) {
    const snapshot = await interactionMonitor.getActiveWindowSnapshot()
    if (snapshot) {
      if (!resolvedIdentity) {
        resolvedIdentity = {
          title: snapshot.title,
          processName: snapshot.processName,
        }
      }
      if (resolvedDisplayId === undefined) {
        resolvedDisplayId = snapshot.displayId
      }
    }
  }

  const session = startSession(resolvedIdentity, resolvedDisplayId)
  try {
    await captureInitialScreenshot(session, reason)
    log.info(`[Session] Initial screenshot captured for session ${session.sessionId}`)
  } catch (error) {
    log.error(`[Session] Failed to capture initial screenshot for ${session.sessionId}:`, error)
  }
}

async function endCurrentSession(endReason: SessionEndReason): Promise<void> {
  const session = currentSession
  if (!session || session.closed) {
    return
  }

  session.closed = true
  currentSession = null
  clearSessionTimer()

  try {
    const finalSource = await capturePreferredSource(FULL_RES_SIZE, session)
    saveScreenshotFromSource(
      finalSource,
      {
        type: 'manual',
        metadata: {
          phase: 'session_end',
          endReason,
        },
      },
      session,
    )
  } catch (error) {
    log.warn(`[Session] Failed to capture final screenshot for ${session.sessionId}:`, error)
  }

  const completed = toCompletedSession(session, endReason, Date.now())
  emitCompletedSession(completed)
  log.info(
    `[Session] Completed ${completed.sessionId} (${completed.appName || 'unknown app'}, ${endReason}, screenshots=${completed.screenshots.length}, events=${completed.interactionEvents.length})`,
  )
}

async function handleAppChange(context: InteractionContext): Promise<void> {
  const nextIdentity = context.activeWindow ?? null
  const previousIdentity = context.previousWindow ?? null
  const nextDisplayId = context.displayId

  if (!currentSession) {
    startSession(previousIdentity, nextDisplayId)
  }

  if (
    currentSession &&
    currentSession.appIdentity?.processName &&
    nextIdentity?.processName &&
    currentSession.appIdentity.processName === nextIdentity.processName
  ) {
    currentSession.appIdentity = nextIdentity
    currentSession.displayId = nextDisplayId
    currentSession.interactionEvents.push(context)
    return
  }

  addInteractionToSession(context)
  await endCurrentSession('app_switch')

  if (isCapturing) {
    await beginSessionAndCaptureInitial(nextIdentity, nextDisplayId, 'app_switch')
  }
}

async function handleRegularInteraction(context: InteractionContext): Promise<void> {
  addInteractionToSession(context)
  const displayId = getDisplayIdForContext(context)
  const session = currentSession
  if (!session) {
    return
  }

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
    log.info(`[Capture] Interaction detected: ${context.type} (display: ${displayId ?? 'unknown'})`)

    const sampleBitmap = await captureSampleBitmap(session)
    const result = visualDetector.checkBitmapAgainstBaseline(sampleBitmap)

    if (!result.changed) {
      log.info(
        `[Capture] No significant change (${result.difference.toFixed(1)}%) - keeping current baseline`,
      )
      return
    }

    log.info(
      `[Capture] Visual change detected (${result.difference.toFixed(1)}%) - capturing full-res screenshot`,
    )

    const fullSource = await capturePreferredSource(FULL_RES_SIZE, session)
    saveScreenshotFromSource(
      fullSource,
      {
        type: 'baseline_change',
        confidence: result.difference,
      },
      currentSession,
    )

    lastCaptureTime = Date.now()
    visualDetector.updateBaselineFromBitmap(sampleBitmap)
    log.info('[Capture] Baseline updated to new screenshot')
  } finally {
    isProcessingInteraction = false
  }
}

async function handleInteraction(context: InteractionContext): Promise<void> {
  if (!isCapturing) {
    return
  }

  if (context.type === 'app_change') {
    await handleAppChange(context)
    return
  }

  await handleRegularInteraction(context)
}

function queueInteraction(context: InteractionContext): void {
  enqueueRecorderWork(async () => {
    await handleInteraction(context)
  })
}

export function startCapture(): void {
  if (isCapturing) {
    log.info('[Capture] Already running')
    return
  }

  log.info('[Capture] Starting screenshot capture with event-driven baseline detection')
  isCapturing = true
  lastCaptureTime = 0
  isProcessingInteraction = false

  visualDetector.startVisualDetection()
  interactionMonitor.startInteractionMonitoring()
  interactionMonitor.onInteraction(queueInteraction)

  enqueueRecorderWork(async () => {
    await beginSessionAndCaptureInitial(null, undefined, 'start')
  })
}

export function stopCapture(): void {
  if (!isCapturing) {
    log.info('[Capture] Not running')
    return
  }

  log.info('[Capture] Stopping screenshot capture')
  isCapturing = false
  lastCaptureTime = 0
  isProcessingInteraction = false

  interactionMonitor.clearInteractionCallback(queueInteraction)
  interactionMonitor.stopInteractionMonitoring()
  visualDetector.stopVisualDetection()

  enqueueRecorderWork(async () => {
    await endCurrentSession('stop')
  })
}

export function onScreenshot(callback: OnScreenshotCallback): void {
  screenshotCallbacks.push(callback)
}

export function onSessionComplete(callback: OnSessionCompleteCallback): void {
  sessionCallbacks.push(callback)
}

export function getScreenshotsDir(): string {
  return SCREENSHOTS_DIR
}

export function isCapturingNow(): boolean {
  return isCapturing
}
