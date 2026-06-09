import { screen } from 'electron'
import { uIOhook, UiohookMouseEvent, UiohookWheelEvent } from 'uiohook-napi'
import { INTERACTION_MONITOR_CONFIG } from '@constants'
import { InteractionContext } from '../../shared/types'
import { addAppWatcherListener, AppWatcherEvent } from './app-watcher'
import { resolveAppWatcherDisplay } from './app-watcher-display'
import log from '../logger'

// State
let isRunning = false

// Typing session accumulation (counters only; timers/lifecycle live in `typingSession`)
let typingSessionKeyCount = 0

// Scroll session accumulation
let scrollSessionAmount = 0
let scrollSessionEventCount = 0
let scrollSessionDirection: 'vertical' | 'horizontal' = 'vertical'

// Click session accumulation
let clickSessionCount = 0
let lastClickPosition: { x: number; y: number } | null = null
let lastClickDisplayId: number | undefined

// App change state
let previousWindow: NonNullable<InteractionContext['activeWindow']> | null = null
let previousWindowDisplayId: number | null = null

// Display resolution state (used by keyboard/scroll handlers)
let cachedDisplayId: number | null = null

// Cached window title from latest app-watcher event (for keyboard context enrichment)
let cachedWindowTitle: string | null = null

// Unsubscribe handle for our app-watcher listener
let appWatcherUnsubscribe: (() => void) | null = null

/**
 * Resolve which Electron Display contains the given global coordinate.
 */
function getDisplayIdForPoint(x: number, y: number): number {
  return screen.getDisplayNearestPoint({ x, y }).id
}

// Callback for when interaction triggers a capture
type OnInteractionCallback = (context: InteractionContext) => void
const interactionCallbacks: OnInteractionCallback[] = []

function notifyInteraction(context: InteractionContext): void {
  interactionCallbacks.forEach((callback) => {
    try {
      callback(context)
    } catch (error) {
      log.error('Error in interaction callback:', error)
    }
  })
}

/**
 * Manages a debounced interaction "session" — a burst of same-type raw events
 * (clicks, keystrokes, scroll) coalesced into emitted InteractionContexts.
 *
 * Two timers drive emission:
 * - a debounce timer, reset on every raw event, emits the final sub-window once
 *   input stops; and
 * - a max-session timer that emits an interim sub-window during *continuous*
 *   input, so a long session (e.g. a 30s scroll) keeps emitting and the
 *   downstream event-capturer window stays alive instead of being cut by its
 *   idle/gap timer.
 *
 * Each emitted sub-window is timestamped at the receipt time of its last raw
 * event (occurrence time) — not at the moment a timer happens to fire.
 */
class DebouncedSession {
  private active = false
  private debounceTimer: NodeJS.Timeout | null = null
  private maxTimer: NodeJS.Timeout | null = null
  private subWindowStart = 0
  private lastEventTime = 0

  constructor(
    // Read lazily so runtime settings changes (capture-settings-manager
    // mutates INTERACTION_MONITOR_CONFIG) take effect without a restart.
    private readonly debounceMs: () => number,
    private readonly maxSessionMs: () => number,
    private readonly handlers: {
      hasActivity: () => boolean
      emit: (subWindowStart: number, lastEventTime: number) => void
      resetAccumulation: () => void
      onStart?: () => void
    },
  ) {}

  /** Call synchronously from the raw event handler, with the receipt time. */
  record(now: number): void {
    if (!this.active) {
      this.active = true
      this.subWindowStart = now
      this.handlers.resetAccumulation()
      this.handlers.onStart?.()
      this.maxTimer = setTimeout(() => this.flushInterim(), this.maxSessionMs())
    }
    this.lastEventTime = now
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.flushFinal(), this.debounceMs())
  }

  private flushInterim(): void {
    if (this.handlers.hasActivity()) {
      this.handlers.emit(this.subWindowStart, this.lastEventTime)
      this.handlers.resetAccumulation()
      this.subWindowStart = this.lastEventTime
    }
    // Re-arm: continuous input keeps emitting at most maxSessionMs apart.
    this.maxTimer = setTimeout(() => this.flushInterim(), this.maxSessionMs())
  }

  private flushFinal(): void {
    if (this.handlers.hasActivity()) {
      this.handlers.emit(this.subWindowStart, this.lastEventTime)
      this.handlers.resetAccumulation()
    }
    this.reset()
  }

  /** Cancel timers and clear lifecycle state without emitting (used on stop). */
  reset(): void {
    this.active = false
    if (this.maxTimer) {
      clearTimeout(this.maxTimer)
      this.maxTimer = null
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }
}

const clickSession = new DebouncedSession(
  () => INTERACTION_MONITOR_CONFIG.CLICK_DEBOUNCE_MS,
  () => INTERACTION_MONITOR_CONFIG.MAX_SESSION_MS,
  {
    hasActivity: () => clickSessionCount > 0,
    resetAccumulation: () => {
      clickSessionCount = 0
    },
    onStart: () => log.info('[Interaction Monitor] Click session started'),
    emit: (subWindowStart, lastEventTime) => {
      log.info(
        `[Interaction Monitor] Click session: ${clickSessionCount} clicks over ${lastEventTime - subWindowStart}ms`,
      )
      notifyInteraction({
        type: 'click',
        timestamp: lastEventTime,
        displayId: lastClickDisplayId,
        clickPosition: lastClickPosition ?? undefined,
      })
    },
  },
)

const typingSession = new DebouncedSession(
  () => INTERACTION_MONITOR_CONFIG.TYPING_DEBOUNCE_MS,
  () => INTERACTION_MONITOR_CONFIG.MAX_SESSION_MS,
  {
    hasActivity: () => typingSessionKeyCount > 0,
    resetAccumulation: () => {
      typingSessionKeyCount = 0
    },
    onStart: () => log.info('[Interaction Monitor] Typing session started'),
    emit: (subWindowStart, lastEventTime) => {
      log.info(
        `[Interaction Monitor] Typing session: ${typingSessionKeyCount} keys over ${lastEventTime - subWindowStart}ms`,
      )
      notifyInteraction({
        type: 'keyboard',
        timestamp: lastEventTime,
        displayId: cachedDisplayId ?? undefined,
        keyCount: typingSessionKeyCount,
        durationMs: Math.max(0, lastEventTime - subWindowStart),
        windowTitle: cachedWindowTitle ?? undefined,
      })
    },
  },
)

const scrollSession = new DebouncedSession(
  () => INTERACTION_MONITOR_CONFIG.SCROLL_DEBOUNCE_MS,
  () => INTERACTION_MONITOR_CONFIG.MAX_SESSION_MS,
  {
    hasActivity: () => scrollSessionEventCount > 0,
    resetAccumulation: () => {
      scrollSessionAmount = 0
      scrollSessionEventCount = 0
    },
    onStart: () => log.info('[Interaction Monitor] Scroll session started'),
    emit: (subWindowStart, lastEventTime) => {
      log.info(
        `[Interaction Monitor] Scroll session: ${scrollSessionAmount} rotation over ${lastEventTime - subWindowStart}ms`,
      )
      notifyInteraction({
        type: 'scroll',
        timestamp: lastEventTime,
        displayId: cachedDisplayId ?? undefined,
        scrollDirection: scrollSessionDirection,
        scrollAmount: scrollSessionAmount,
        durationMs: Math.max(0, lastEventTime - subWindowStart),
      })
    },
  },
)

/**
 * Handle mouse click events
 * Debounced: accumulates clicks and emits a single event when clicking stops,
 * matching the session pattern used by keyboard and scroll handlers.
 */
function handleMouseClick(event: UiohookMouseEvent): void {
  if (!INTERACTION_MONITOR_CONFIG.TRACK_CLICKS) {
    return
  }

  clickSession.record(Date.now())
  clickSessionCount++
  lastClickPosition = { x: event.x, y: event.y }
  lastClickDisplayId = getDisplayIdForPoint(event.x, event.y)
}

/**
 * Handle keyboard events (if enabled)
 * Tracks "typing sessions" - emits event when user pauses typing
 */
function handleKeyboard(): void {
  if (!INTERACTION_MONITOR_CONFIG.TRACK_KEYBOARD) {
    return
  }

  typingSession.record(Date.now())
  typingSessionKeyCount++
}

/**
 * Handle mouse wheel events (scroll)
 * Tracks "scroll sessions" - emits event when user pauses scrolling
 */
function handleScroll(event: UiohookWheelEvent): void {
  if (!INTERACTION_MONITOR_CONFIG.TRACK_SCROLL) {
    return
  }

  scrollSession.record(Date.now())
  scrollSessionAmount += event.rotation
  scrollSessionEventCount++
  scrollSessionDirection = event.direction === 3 ? 'vertical' : 'horizontal' // WheelDirection.VERTICAL = 3
}

/**
 * Handle events from the native app-watcher process.
 * Translates AppWatcherEvent into InteractionContext for downstream consumers.
 */
function handleAppWatcherEvent(event: AppWatcherEvent): void {
  log.debug(
    `[Interaction Monitor] Received AppWatcher event: type=${event.type} app=${event.app} title=${event.title}`,
  )

  if (event.type === 'ready') {
    log.info('[Interaction Monitor] AppWatcher is ready and streaming events')
    return
  }
  if (event.type === 'error') {
    log.warn(`[Interaction Monitor] AppWatcher error: ${event.error}`)
    return
  }

  // Both app_change and window_change map to the same InteractionContext type
  const current: NonNullable<InteractionContext['activeWindow']> = {
    title: event.title ?? '',
    processName: event.app ?? '',
    ...(event.hwnd && { hwnd: event.hwnd }),
    ...(event.bundleId && { bundleId: event.bundleId }),
    ...(event.url && { url: event.url }),
  }

  // Cache window title for keyboard context enrichment
  cachedWindowTitle = current.title

  const resolvedDisplay = resolveAppWatcherDisplay(event)
  if (resolvedDisplay.source === 'cursor_fallback' && event.windowBounds) {
    log.warn(
      '[Interaction Monitor] Falling back from windowBounds display resolution to cursor-based resolution',
    )
  }
  const resolvedDisplayId = resolvedDisplay.displayId

  // Skip if nothing actually changed
  if (
    previousWindow &&
    previousWindow.title === current.title &&
    previousWindow.processName === current.processName &&
    previousWindow.hwnd === current.hwnd &&
    previousWindowDisplayId === resolvedDisplayId
  ) {
    log.debug(`[Interaction Monitor] Skipping duplicate: ${current.processName} "${current.title}"`)
    return
  }

  cachedDisplayId = resolvedDisplayId

  log.info(
    `[Interaction Monitor] App changed from ${previousWindow?.processName ?? '(none)'} to ${current.processName}`,
  )

  const context: InteractionContext = {
    type: 'app_change',
    timestamp: event.timestamp,
    displayId: resolvedDisplayId,
    activeWindow: current,
    previousWindow: previousWindow ?? undefined,
  }

  previousWindow = current
  previousWindowDisplayId = resolvedDisplayId

  // Notify all callbacks
  log.debug(
    `[Interaction Monitor] Dispatching app_change to ${interactionCallbacks.length} callback(s)`,
  )
  interactionCallbacks.forEach((callback) => {
    try {
      callback(context)
    } catch (error) {
      log.error('Error in interaction callback:', error)
    }
  })
}

/**
 * Start monitoring user interactions
 */
export function startInteractionMonitoring(): void {
  if (isRunning) {
    log.info('[Interaction Monitor] Already running')
    return
  }

  if (!INTERACTION_MONITOR_CONFIG.ENABLED) {
    log.info('[Interaction Monitor] Disabled in config')
    return
  }

  try {
    log.info('[Interaction Monitor] Starting')
    isRunning = true

    // Register event handlers
    if (INTERACTION_MONITOR_CONFIG.TRACK_CLICKS) {
      uIOhook.on('click', handleMouseClick)
    }

    if (INTERACTION_MONITOR_CONFIG.TRACK_KEYBOARD) {
      uIOhook.on('keydown', handleKeyboard)
    }

    if (INTERACTION_MONITOR_CONFIG.TRACK_SCROLL) {
      uIOhook.on('wheel', handleScroll)
    }

    // Start the hook
    uIOhook.start()
    log.info('[Interaction Monitor] uiohook started successfully')

    // Start native app-watcher process for app/window change events
    if (INTERACTION_MONITOR_CONFIG.TRACK_APP_CHANGE) {
      appWatcherUnsubscribe = addAppWatcherListener(handleAppWatcherEvent)
      log.info('[Interaction Monitor] App watcher started')
    }
  } catch (error) {
    log.error('[Interaction Monitor] Failed to start:', error)
    isRunning = false
    throw error
  }
}

/**
 * Stop monitoring user interactions
 * This will clear all registered callbacks - they will need to be re-registered if you want to start monitoring again
 */
export function stopInteractionMonitoring(): void {
  if (!isRunning) {
    log.info('[Interaction Monitor] Not running')
    return
  }

  try {
    log.info('[Interaction Monitor] Stopping')
    isRunning = false

    // Cancel pending session timers and clear accumulation
    clickSession.reset()
    typingSession.reset()
    scrollSession.reset()
    typingSessionKeyCount = 0
    scrollSessionAmount = 0
    scrollSessionEventCount = 0
    clickSessionCount = 0
    lastClickPosition = null
    lastClickDisplayId = undefined
    previousWindow = null
    previousWindowDisplayId = null
    cachedDisplayId = null
    cachedWindowTitle = null

    // Stop the native app-watcher process (only our listener; others may still be attached)
    if (appWatcherUnsubscribe) {
      appWatcherUnsubscribe()
      appWatcherUnsubscribe = null
    }

    // Stop the hook
    uIOhook.stop()

    // Remove event listeners
    uIOhook.removeAllListeners()
  } catch (error) {
    log.error('[Interaction Monitor] Failed to stop:', error)
  }
}

/**
 * Register a callback to be notified when interactions trigger captures.
 */
export function onInteraction(callback: OnInteractionCallback): void {
  interactionCallbacks.push(callback)
  log.info(`[Interaction Monitor] Callback registered (total: ${interactionCallbacks.length})`)
}

/**
 * Clear a specific callback from the registered callbacks.
 */
export function clearInteractionCallback(callback: OnInteractionCallback): void {
  if (!interactionCallbacks.includes(callback)) {
    log.warn(
      `[Interaction Monitor] Callback not found for removal (total: ${interactionCallbacks.length})`,
    )
    return
  }
  interactionCallbacks.splice(interactionCallbacks.indexOf(callback), 1)
  log.info(`[Interaction Monitor] Callback removed (total: ${interactionCallbacks.length})`)
}

/**
 * Check if interaction monitoring is currently running
 */
export function isMonitoring(): boolean {
  return isRunning
}
