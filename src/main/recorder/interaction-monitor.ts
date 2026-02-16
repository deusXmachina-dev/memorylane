import { screen } from 'electron'
import { uIOhook, UiohookMouseEvent, UiohookWheelEvent } from 'uiohook-napi'
import activeWin from 'active-win'
import { INTERACTION_MONITOR_CONFIG } from '@constants'
import { InteractionContext } from '../../shared/types'
import log from '../logger'

// State
let isRunning = false
let typingSessionTimeoutId: NodeJS.Timeout | null = null
let isTyping = false
let typingSessionKeyCount = 0
let typingSessionStartTime = 0

// Scroll state
let scrollSessionTimeoutId: NodeJS.Timeout | null = null
let isScrolling = false
let scrollSessionAmount = 0
let scrollSessionDirection: 'vertical' | 'horizontal' = 'vertical'
let scrollSessionStartTime = 0

// Click throttle state
let lastClickTime = 0

// App change state
let appChangeIntervalId: NodeJS.Timeout | null = null
let previousWindow: { title: string; processName: string } | null = null
let appChangeFailureSkips = 0

// Activity-gated polling state
let idleTimeoutId: NodeJS.Timeout | null = null

// Display resolution state (updated by app-change poller, used by keyboard/scroll handlers)
let cachedDisplayId: number | null = null

export interface ActiveWindowSnapshot {
  title: string
  processName: string
  displayId: number
}

/**
 * Resolve which Electron Display contains the given global coordinate.
 */
function getDisplayIdForPoint(x: number, y: number): number {
  return screen.getDisplayNearestPoint({ x, y }).id
}

export async function getActiveWindowSnapshot(): Promise<ActiveWindowSnapshot | null> {
  try {
    const currentWindow = await activeWin()

    if (!currentWindow) {
      return null
    }

    const centerX = currentWindow.bounds.x + currentWindow.bounds.width / 2
    const centerY = currentWindow.bounds.y + currentWindow.bounds.height / 2

    return {
      title: currentWindow.title,
      processName: currentWindow.owner.name,
      displayId: getDisplayIdForPoint(centerX, centerY),
    }
  } catch (error) {
    log.warn('[Interaction Monitor] Failed to fetch active window snapshot:', error)
    return null
  }
}

/**
 * Start (or restart) app-change polling on user activity.
 * Automatically stops polling after APP_CHANGE_IDLE_TIMEOUT_MS of inactivity.
 */
function markUserActivity(): void {
  if (!isRunning || !INTERACTION_MONITOR_CONFIG.TRACK_APP_CHANGE) return

  // (Re)start the idle timeout
  if (idleTimeoutId) clearTimeout(idleTimeoutId)
  idleTimeoutId = setTimeout(() => {
    if (appChangeIntervalId) {
      clearInterval(appChangeIntervalId)
      appChangeIntervalId = null
      log.info('[Interaction Monitor] App change polling paused (idle)')
    }
  }, INTERACTION_MONITOR_CONFIG.APP_CHANGE_IDLE_TIMEOUT_MS)

  // Start polling if not already running
  if (!appChangeIntervalId) {
    log.info('[Interaction Monitor] App change polling resumed (activity)')
    checkAppChange().catch(log.error)
    appChangeIntervalId = setInterval(() => {
      checkAppChange().catch(log.error)
    }, INTERACTION_MONITOR_CONFIG.APP_CHANGE_POLL_MS)
  }
}

// Callback for when interaction triggers a capture
type OnInteractionCallback = (context: InteractionContext) => void
const interactionCallbacks: OnInteractionCallback[] = []

/**
 * Handle mouse click events
 * Throttled to prevent rapid-fire captures from fast clicking
 */
function handleMouseClick(event: UiohookMouseEvent): void {
  markUserActivity()

  if (!INTERACTION_MONITOR_CONFIG.TRACK_CLICKS) {
    return
  }

  const now = Date.now()
  if (now - lastClickTime < INTERACTION_MONITOR_CONFIG.CLICK_THROTTLE_MS) {
    return
  }
  lastClickTime = now

  const displayId = getDisplayIdForPoint(event.x, event.y)

  const context: InteractionContext = {
    type: 'click',
    timestamp: now,
    displayId,
    clickPosition: {
      x: event.x,
      y: event.y,
    },
  }

  interactionCallbacks.forEach((callback) => {
    try {
      callback(context)
    } catch (error) {
      log.error('Error in interaction callback:', error)
    }
  })
}

/**
 * Handle keyboard events (if enabled)
 * Tracks "typing sessions" - emits event when user pauses typing
 */
function handleKeyboard(): void {
  markUserActivity()

  if (!INTERACTION_MONITOR_CONFIG.TRACK_KEYBOARD) {
    return
  }

  const now = Date.now()

  // Clear any existing typing session timeout
  if (typingSessionTimeoutId) {
    clearTimeout(typingSessionTimeoutId)
  }

  // Mark that user is typing and track session
  if (!isTyping) {
    isTyping = true
    typingSessionKeyCount = 0
    typingSessionStartTime = now
    log.info('[Interaction Monitor] Typing session started')
  }

  // Increment key count
  typingSessionKeyCount++

  // Set timeout to detect when typing stops
  typingSessionTimeoutId = setTimeout(() => {
    if (!isTyping) return

    isTyping = false
    const endTime = Date.now() - INTERACTION_MONITOR_CONFIG.TYPING_SESSION_TIMEOUT_MS
    const durationMs =
      endTime - typingSessionStartTime - INTERACTION_MONITOR_CONFIG.TYPING_SESSION_TIMEOUT_MS

    log.info(
      `[Interaction Monitor] Typing session ended: ${typingSessionKeyCount} keys over ${durationMs}ms`,
    )

    const context: InteractionContext = {
      type: 'keyboard',
      timestamp: endTime,
      displayId: cachedDisplayId ?? undefined,
      keyCount: typingSessionKeyCount,
      durationMs: durationMs,
    }

    // Notify all callbacks
    interactionCallbacks.forEach((callback) => {
      try {
        callback(context)
      } catch (error) {
        log.error('Error in interaction callback:', error)
      }
    })

    // Reset session tracking
    typingSessionKeyCount = 0
    typingSessionStartTime = 0
  }, INTERACTION_MONITOR_CONFIG.TYPING_SESSION_TIMEOUT_MS)
}

/**
 * Handle mouse wheel events (scroll)
 * Tracks "scroll sessions" - emits event when user pauses scrolling
 */
function handleScroll(event: UiohookWheelEvent): void {
  markUserActivity()

  if (!INTERACTION_MONITOR_CONFIG.TRACK_SCROLL) {
    return
  }

  const now = Date.now()

  // Clear any existing scroll session timeout
  if (scrollSessionTimeoutId) {
    clearTimeout(scrollSessionTimeoutId)
  }

  // Mark that user is scrolling and track session
  if (!isScrolling) {
    isScrolling = true
    scrollSessionAmount = 0
    scrollSessionStartTime = now
    scrollSessionDirection = event.direction === 3 ? 'vertical' : 'horizontal' // WheelDirection.VERTICAL = 3
    log.info('[Interaction Monitor] Scroll session started')
  }

  // Accumulate scroll amount
  scrollSessionAmount += event.rotation

  // Set timeout to detect when scrolling stops
  scrollSessionTimeoutId = setTimeout(() => {
    if (!isScrolling) return

    isScrolling = false
    const endTime = Date.now() - INTERACTION_MONITOR_CONFIG.SCROLL_SESSION_TIMEOUT_MS
    const durationMs = endTime - scrollSessionStartTime

    log.info(
      `[Interaction Monitor] Scroll session ended: ${scrollSessionAmount} rotation over ${durationMs}ms`,
    )

    const context: InteractionContext = {
      type: 'scroll',
      timestamp: endTime,
      displayId: cachedDisplayId ?? undefined,
      scrollDirection: scrollSessionDirection,
      scrollAmount: scrollSessionAmount,
    }

    // Notify all callbacks
    interactionCallbacks.forEach((callback) => {
      try {
        callback(context)
      } catch (error) {
        log.error('Error in interaction callback:', error)
      }
    })

    // Reset session tracking
    scrollSessionAmount = 0
    scrollSessionStartTime = 0
  }, INTERACTION_MONITOR_CONFIG.SCROLL_SESSION_TIMEOUT_MS)
}

/**
 * Check for app/window changes
 * Called periodically by interval timer
 */
async function checkAppChange(): Promise<void> {
  if (!INTERACTION_MONITOR_CONFIG.TRACK_APP_CHANGE) {
    return
  }

  if (appChangeFailureSkips > 0) {
    appChangeFailureSkips--
    return
  }

  try {
    const snapshot = await getActiveWindowSnapshot()
    if (!snapshot) {
      return
    }

    const current = {
      title: snapshot.title,
      processName: snapshot.processName,
    }
    cachedDisplayId = snapshot.displayId

    // Check if window has changed
    if (
      previousWindow &&
      (previousWindow.title !== current.title || previousWindow.processName !== current.processName)
    ) {
      log.info(
        `[Interaction Monitor] App changed from ${previousWindow.processName} to ${current.processName}`,
      )

      const context: InteractionContext = {
        type: 'app_change',
        timestamp: Date.now(),
        displayId: cachedDisplayId,
        activeWindow: current,
        previousWindow: previousWindow,
      }

      // Notify all callbacks
      interactionCallbacks.forEach((callback) => {
        try {
          callback(context)
        } catch (error) {
          log.error('Error in interaction callback:', error)
        }
      })
    }

    // Update previous window
    previousWindow = current
  } catch (error) {
    appChangeFailureSkips = INTERACTION_MONITOR_CONFIG.APP_CHANGE_FAILURE_SKIPS_N_POLLS_AFTER_ERROR
    log.warn('[Interaction Monitor] Error checking active window, pausing for 3 polls:', error)
  }
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

    // App change polling is now activity-gated:
    // markUserActivity() will start the interval on the first user event.
    if (INTERACTION_MONITOR_CONFIG.TRACK_APP_CHANGE) {
      log.info('[Interaction Monitor] App change polling will start on first user activity')
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
    isTyping = false
    typingSessionKeyCount = 0
    typingSessionStartTime = 0
    isScrolling = false
    scrollSessionAmount = 0
    scrollSessionStartTime = 0
    lastClickTime = 0
    previousWindow = null
    appChangeFailureSkips = 0
    cachedDisplayId = null

    // Clear any pending typing session timeout
    if (typingSessionTimeoutId) {
      clearTimeout(typingSessionTimeoutId)
      typingSessionTimeoutId = null
    }

    // Clear any pending scroll session timeout
    if (scrollSessionTimeoutId) {
      clearTimeout(scrollSessionTimeoutId)
      scrollSessionTimeoutId = null
    }

    // Clear app change polling interval
    if (appChangeIntervalId) {
      clearInterval(appChangeIntervalId)
      appChangeIntervalId = null
    }

    // Clear idle timeout
    if (idleTimeoutId) {
      clearTimeout(idleTimeoutId)
      idleTimeoutId = null
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
