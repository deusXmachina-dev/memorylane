/**
 * ActivityManager - Core state machine for app-switch-driven activity windows.
 *
 * Manages activity lifecycle: when the user switches apps, the current activity
 * ends and a new one begins. Within an activity, screenshots and interactions
 * are accumulated for a single, richer LLM summary.
 */

import { v4 as uuidv4 } from 'uuid'
import { Activity, ActivityScreenshot, InteractionContext } from '../../shared/types'
import {
  ACTIVITY_CONFIG,
  BROWSER_BUNDLE_IDS,
  TRANSIENT_APP_BUNDLE_IDS,
} from '../../shared/constants'
import { extractTld, isTldChange } from '../recorder/tld-utils'
import log from '../logger'

type OnActivityCompleteCallback = (activity: Activity) => void

interface CaptureProvider {
  captureImmediate: (
    trigger: ActivityScreenshot['trigger'],
    displayId?: number,
  ) => Promise<ActivityScreenshot>
  captureWindowByTitle?: (
    title: string,
    trigger: ActivityScreenshot['trigger'],
  ) => Promise<ActivityScreenshot | null>
}

export class ActivityManager {
  private currentActivity: Activity | null = null
  private forceSplitTimer: NodeJS.Timeout | null = null
  private captureTimer: NodeJS.Timeout | null = null
  private callbacks: OnActivityCompleteCallback[] = []
  private captureProvider: CaptureProvider
  private eventQueue: Promise<void> = Promise.resolve()
  private isIntervalCaptureInFlight = false

  constructor(captureProvider: CaptureProvider) {
    this.captureProvider = captureProvider
  }

  /**
   * Register a callback for completed activities.
   */
  public onActivityComplete(callback: OnActivityCompleteCallback): void {
    this.callbacks.push(callback)
  }

  /**
   * Handle an interaction event from the interaction monitor.
   * Routes to the appropriate handler based on event type.
   */
  public async handleInteraction(event: InteractionContext): Promise<void> {
    this.enqueueWork(() => this.processEvent(event), '[ActivityManager] Error processing event:')
    return this.eventQueue
  }

  private enqueueWork(work: () => Promise<void>, errorMessage: string): void {
    this.eventQueue = this.eventQueue.then(work).catch((err) => {
      log.error(errorMessage, err)
    })
  }

  private async processEvent(event: InteractionContext): Promise<void> {
    if (event.type === 'app_change') {
      await this.handleAppChange(event)
    } else {
      await this.handleOtherInteraction(event)
    }
  }

  /**
   * Force-close the current activity (called on sleep/lock/stop).
   */
  public async forceClose(): Promise<void> {
    if (!this.currentActivity) return

    log.info('[ActivityManager] Force-closing current activity')

    try {
      const endScreenshot = await this.captureProvider.captureImmediate('activity_end')
      this.addScreenshot(endScreenshot)
    } catch (error) {
      log.warn('[ActivityManager] Failed to capture end screenshot on force-close:', error)
    }

    await this.finalizeCurrentActivity()
  }

  /**
   * Get the current activity (for debugging/testing).
   */
  public getCurrentActivity(): Activity | null {
    return this.currentActivity
  }

  // ---------------------------------------------------------------------------
  // Private: App change handling
  // ---------------------------------------------------------------------------

  private async handleAppChange(event: InteractionContext): Promise<void> {
    const newApp = event.activeWindow
    if (!newApp) return

    const newBundleId = newApp.bundleId
    const newProcessName = newApp.processName

    // Skip transient apps (Spotlight, notification center, etc.)
    if (newBundleId && TRANSIENT_APP_BUNDLE_IDS.has(newBundleId)) {
      log.info(
        `[ActivityManager] Transient app detected (${newProcessName}), keeping current activity`,
      )
      if (this.currentActivity) {
        this.currentActivity.interactions.push(event)
      }
      return
    }

    // Check if this is truly a new activity boundary
    if (this.currentActivity && !this.isActivityBoundary(event)) {
      // Same app, same context — just accumulate the event
      this.currentActivity.interactions.push(event)
      return
    }

    // End current activity if it exists.
    // Capture the OLD window by title — even though the new app is foregrounded,
    // desktopCapturer can capture background windows individually.
    if (this.currentActivity) {
      if (this.captureProvider.captureWindowByTitle) {
        try {
          const oldTitle = event.previousWindow?.title || this.currentActivity.windowTitle
          log.debug(
            `[ActivityManager] Capturing end screenshot by window title: "${oldTitle}" ` +
              `(previousWindow: "${event.previousWindow?.title}", activity windowTitle: "${this.currentActivity.windowTitle}")`,
          )
          const endScreenshot = await this.captureProvider.captureWindowByTitle(
            oldTitle,
            'activity_end',
          )
          if (endScreenshot) {
            this.addScreenshot(endScreenshot)
          }
        } catch (error) {
          log.warn('[ActivityManager] Failed to capture end window screenshot:', error)
        }
      }
      await this.finalizeCurrentActivity()
    }

    // Start new activity
    await this.startNewActivity(event)
  }

  /**
   * Determine if an app_change event represents an activity boundary.
   */
  private isActivityBoundary(event: InteractionContext): boolean {
    if (!this.currentActivity) return true

    const newApp = event.activeWindow!
    const currentBundleId = this.currentActivity.bundleId
    const newBundleId = newApp.bundleId

    // Different app (by bundle ID if available, otherwise by process name)
    if (newBundleId && currentBundleId) {
      if (newBundleId !== currentBundleId) return true
    } else if (newApp.processName !== this.currentActivity.appName) {
      return true
    }

    // Same browser but different TLD → activity boundary
    if (newBundleId && BROWSER_BUNDLE_IDS.has(newBundleId)) {
      if (isTldChange(this.currentActivity.url, newApp.url)) {
        log.info('[ActivityManager] Browser TLD change detected — new activity boundary')
        return true
      }
    }

    return false
  }

  // ---------------------------------------------------------------------------
  // Private: Other interaction handling
  // ---------------------------------------------------------------------------

  private async handleOtherInteraction(event: InteractionContext): Promise<void> {
    if (!this.currentActivity) return

    // Accumulate the interaction
    this.currentActivity.interactions.push(event)
  }

  // ---------------------------------------------------------------------------
  // Private: Activity lifecycle
  // ---------------------------------------------------------------------------

  private async startNewActivity(event: InteractionContext): Promise<void> {
    const window = event.activeWindow!
    const url = window.url ?? undefined
    const tld = extractTld(url) ?? undefined

    this.currentActivity = {
      id: uuidv4(),
      startTimestamp: event.timestamp,
      appName: window.processName,
      bundleId: window.bundleId,
      windowTitle: window.title,
      url,
      tld,
      screenshots: [],
      interactions: [event],
    }

    log.info(
      `[ActivityManager] Started new activity ${this.currentActivity.id} for ${window.processName} "${window.title}"`,
    )

    // Capture start screenshot
    try {
      const startScreenshot = await this.captureProvider.captureImmediate('activity_start')
      this.addScreenshot(startScreenshot)
    } catch (error) {
      log.warn('[ActivityManager] Failed to capture start screenshot:', error)
    }

    // Start periodic timer
    this.startActivityTimers()
  }

  private async finalizeCurrentActivity(): Promise<void> {
    if (!this.currentActivity) return

    this.stopActivityTimers()

    const activity = this.currentActivity
    this.currentActivity = null

    activity.endTimestamp = Date.now()
    const durationMs = activity.endTimestamp - activity.startTimestamp

    // Discard activities shorter than minimum duration
    if (durationMs < ACTIVITY_CONFIG.MIN_ACTIVITY_DURATION_MS) {
      log.info(
        `[ActivityManager] Discarding short activity ${activity.id} (${durationMs}ms < ${ACTIVITY_CONFIG.MIN_ACTIVITY_DURATION_MS}ms)`,
      )
      return
    }

    log.info(
      `[ActivityManager] Finalizing activity ${activity.id}: ${activity.appName} "${activity.windowTitle}" ` +
        `(${durationMs}ms, ${activity.screenshots.length} screenshots, ${activity.interactions.length} interactions)`,
    )

    // Notify callbacks
    for (const callback of this.callbacks) {
      try {
        callback(activity)
      } catch (error) {
        log.error('[ActivityManager] Error in activity complete callback:', error)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Periodic capture
  // ---------------------------------------------------------------------------

  private startActivityTimers(): void {
    this.stopActivityTimers()

    this.captureTimer = setInterval(() => {
      this.enqueueWork(
        () => this.capturePeriodicScreenshot(),
        '[ActivityManager] Error in periodic capture:',
      )
    }, ACTIVITY_CONFIG.PERIODIC_CAPTURE_INTERVAL_MS)

    this.forceSplitTimer = setInterval(() => {
      this.enqueueWork(
        () => this.checkForceSplit(),
        '[ActivityManager] Error in force-split check:',
      )
    }, ACTIVITY_CONFIG.FORCE_SPLIT_CHECK_INTERVAL_MS)
  }

  private stopActivityTimers(): void {
    if (this.captureTimer) {
      clearInterval(this.captureTimer)
      this.captureTimer = null
    }
    if (this.forceSplitTimer) {
      clearInterval(this.forceSplitTimer)
      this.forceSplitTimer = null
    }
    this.isIntervalCaptureInFlight = false
  }

  private async capturePeriodicScreenshot(): Promise<void> {
    if (!this.currentActivity || this.isIntervalCaptureInFlight) return
    if (this.currentActivity.screenshots.length >= ACTIVITY_CONFIG.MAX_SCREENSHOTS_PER_ACTIVITY)
      return

    this.isIntervalCaptureInFlight = true
    try {
      const screenshot = await this.captureProvider.captureImmediate('periodic')
      this.addScreenshot(screenshot)
    } catch (error) {
      log.warn('[ActivityManager] Failed periodic capture:', error)
    } finally {
      this.isIntervalCaptureInFlight = false
    }
  }

  private async checkForceSplit(): Promise<void> {
    if (!this.currentActivity) return

    const elapsed = Date.now() - this.currentActivity.startTimestamp
    if (elapsed < ACTIVITY_CONFIG.MAX_ACTIVITY_DURATION_MS) return

    log.info(`[ActivityManager] Max activity duration exceeded (${elapsed}ms), force-splitting`)

    // Capture end, finalize, and start a new activity for the same app
    try {
      const endScreenshot = await this.captureProvider.captureImmediate('activity_end')
      this.addScreenshot(endScreenshot)
    } catch (error) {
      log.warn('[ActivityManager] Failed to capture end screenshot for force-split:', error)
    }

    // Save current app info before finalize clears it
    const currentAppEvent: InteractionContext = {
      type: 'app_change',
      timestamp: Date.now(),
      activeWindow: {
        title: this.currentActivity.windowTitle,
        processName: this.currentActivity.appName,
        bundleId: this.currentActivity.bundleId,
        url: this.currentActivity.url,
      },
    }

    await this.finalizeCurrentActivity()
    await this.startNewActivity(currentAppEvent)
  }

  // ---------------------------------------------------------------------------
  // Private: Helpers
  // ---------------------------------------------------------------------------

  private addScreenshot(screenshot: ActivityScreenshot): void {
    if (!this.currentActivity) return

    if (this.currentActivity.screenshots.length >= ACTIVITY_CONFIG.MAX_SCREENSHOTS_PER_ACTIVITY) {
      log.debug(
        `[ActivityManager] Max screenshots reached for activity ${this.currentActivity.id}, skipping`,
      )
      return
    }

    this.currentActivity.screenshots.push(screenshot)
    log.debug(
      `[ActivityManager] Added ${screenshot.trigger} screenshot to activity ${this.currentActivity.id} (total: ${this.currentActivity.screenshots.length})`,
    )
  }
}
