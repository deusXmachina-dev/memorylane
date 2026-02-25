/**
 * ActivityManager - Core state machine for app-switch-driven activity windows.
 *
 * Manages activity lifecycle: when the user switches apps, the current activity
 * ends and a new one begins. Within an activity, screenshots and interactions
 * are accumulated for a single, richer LLM summary.
 */

import { v4 as uuidv4 } from 'uuid'
import { Activity, ActivityScreenshot, InteractionContext } from '../../shared/types'
import { ACTIVITY_CONFIG } from '../../shared/constants'
import { isBrowserApp, isTransientApp } from '../../shared/app-utils'
import { extractTld, isTldChange } from '../recorder/tld-utils'
import log from '../logger'

type OnActivityCompleteCallback = (activity: Activity) => void

interface CaptureProvider {
  captureImmediate: (
    trigger: ActivityScreenshot['trigger'],
    displayId?: number,
  ) => Promise<ActivityScreenshot>
  captureIfVisualChange: (
    trigger: ActivityScreenshot['trigger'],
    displayId?: number,
  ) => Promise<ActivityScreenshot | null>
  captureWindowByTitle?: (
    title: string,
    trigger: ActivityScreenshot['trigger'],
  ) => Promise<ActivityScreenshot | null>
}

export class ActivityManager {
  private currentActivity: Activity | null = null
  private currentActivityDisplayId: number | undefined = undefined
  private periodicTimer: NodeJS.Timeout | null = null
  private callbacks: OnActivityCompleteCallback[] = []
  private captureProvider: CaptureProvider
  private eventQueue: Promise<void> = Promise.resolve()

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
    this.eventQueue = this.eventQueue
      .then(() => this.processEvent(event))
      .catch((err) => {
        log.error('[ActivityManager] Error processing event:', err)
      })
    return this.eventQueue
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
    const boundaryTimestamp = Date.now()

    try {
      const endScreenshot = await this.captureProvider.captureImmediate(
        'activity_end',
        this.currentActivityDisplayId,
      )
      this.addScreenshot(endScreenshot)
    } catch (error) {
      log.warn('[ActivityManager] Failed to capture end screenshot on force-close:', error)
    }

    await this.finalizeCurrentActivity(boundaryTimestamp)
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

    const newProcessName = newApp.processName

    // Skip transient apps (Spotlight, notification center, etc.)
    if (isTransientApp(newApp)) {
      log.info(
        `[ActivityManager] Transient app detected (${newProcessName}), keeping current activity`,
      )
      if (this.currentActivity) {
        this.currentActivity.interactions.push(event)
        if (event.displayId !== undefined) {
          this.currentActivityDisplayId = event.displayId
        }
      }
      return
    }

    // Check if this is truly a new activity boundary
    if (this.currentActivity && !this.isActivityBoundary(event)) {
      // Same app, same context — just accumulate the event
      this.currentActivity.interactions.push(event)
      if (event.displayId !== undefined) {
        this.currentActivityDisplayId = event.displayId
      }
      return
    }

    // End current activity if it exists.
    // Capture the OLD window by title — even though the new app is foregrounded,
    // desktopCapturer can capture background windows individually.
    if (this.currentActivity) {
      let endScreenshot: ActivityScreenshot | null = null
      const boundaryDisplayId =
        event.previousDisplayId ?? this.currentActivityDisplayId ?? event.displayId

      if (this.captureProvider.captureWindowByTitle) {
        try {
          const oldTitle = event.previousWindow?.title || this.currentActivity.windowTitle
          log.debug(
            `[ActivityManager] Capturing end screenshot by window title: "${oldTitle}" ` +
              `(previousWindow: "${event.previousWindow?.title}", activity windowTitle: "${this.currentActivity.windowTitle}")`,
          )
          endScreenshot = await this.captureProvider.captureWindowByTitle(oldTitle, 'activity_end')
        } catch (error) {
          log.warn('[ActivityManager] Failed to capture end window screenshot:', error)
        }
      }

      if (!endScreenshot) {
        try {
          endScreenshot = await this.captureProvider.captureImmediate(
            'activity_end',
            boundaryDisplayId,
          )
        } catch (error) {
          log.warn('[ActivityManager] Failed fallback end screenshot capture:', error)
        }
      }

      if (endScreenshot) {
        this.addScreenshot(endScreenshot)
      }
      const boundaryTimestamp = this.getMonotonicBoundaryTimestamp(
        event.timestamp,
        this.currentActivity.startTimestamp,
      )
      await this.finalizeCurrentActivity(boundaryTimestamp)
      // Use the same boundary timestamp to guarantee old.end === new.start.
      await this.startNewActivity(event, boundaryTimestamp)
      return
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
    if (isBrowserApp(newApp)) {
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
    if (event.displayId !== undefined) {
      this.currentActivityDisplayId = event.displayId
    }

    // Try visual-change-gated capture for non-app-change interactions
    if (this.currentActivity.screenshots.length < ACTIVITY_CONFIG.MAX_SCREENSHOTS_PER_ACTIVITY) {
      try {
        const screenshot = await this.captureProvider.captureIfVisualChange(
          'visual_change',
          this.currentActivityDisplayId,
        )
        if (screenshot) {
          this.addScreenshot(screenshot)
        }
      } catch (error) {
        log.warn('[ActivityManager] Failed visual change capture:', error)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Activity lifecycle
  // ---------------------------------------------------------------------------

  private async startNewActivity(
    event: InteractionContext,
    startTimestampOverride?: number,
  ): Promise<void> {
    const window = event.activeWindow!
    const url = window.url ?? undefined
    const tld = extractTld(url) ?? undefined
    if (event.displayId !== undefined) {
      this.currentActivityDisplayId = event.displayId
    }

    this.currentActivity = {
      id: uuidv4(),
      startTimestamp: startTimestampOverride ?? event.timestamp,
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
      const startScreenshot = await this.captureProvider.captureImmediate(
        'activity_start',
        this.currentActivityDisplayId,
      )
      this.addScreenshot(startScreenshot)
    } catch (error) {
      log.warn('[ActivityManager] Failed to capture start screenshot:', error)
    }

    // Start periodic timer
    this.startPeriodicTimer()
  }

  private async finalizeCurrentActivity(endTimestamp: number): Promise<void> {
    if (!this.currentActivity) return

    this.stopPeriodicTimer()

    const activity = this.currentActivity
    this.currentActivity = null
    this.currentActivityDisplayId = undefined

    activity.endTimestamp = endTimestamp
    const durationMs = activity.endTimestamp - activity.startTimestamp

    // Discard activities shorter than minimum duration
    if (durationMs < ACTIVITY_CONFIG.MIN_ACTIVITY_DURATION_MS) {
      log.info(
        `[ActivityManager] Discarding short activity ${activity.id} (${durationMs}ms < ${ACTIVITY_CONFIG.MIN_ACTIVITY_DURATION_MS}ms)`,
      )
      return
    }

    log.info(
      `[ActivityManager] Finalizing activity ${activity.id}: ${activity.appName} "${activity.windowTitle}" (${durationMs}ms, ${activity.screenshots.length} screenshots, ${activity.interactions.length} interactions)`,
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

  private startPeriodicTimer(): void {
    this.stopPeriodicTimer()

    this.periodicTimer = setInterval(async () => {
      if (!this.currentActivity) return

      // Check if max duration exceeded → force-split
      const elapsed = Date.now() - this.currentActivity.startTimestamp
      if (elapsed >= ACTIVITY_CONFIG.MAX_ACTIVITY_DURATION_MS) {
        log.info(`[ActivityManager] Max activity duration exceeded (${elapsed}ms), force-splitting`)
        const boundaryTimestamp = Date.now()
        // Capture end, finalize, and start a new activity for the same app
        try {
          const endScreenshot = await this.captureProvider.captureImmediate(
            'activity_end',
            this.currentActivityDisplayId,
          )
          this.addScreenshot(endScreenshot)
        } catch (error) {
          log.warn('[ActivityManager] Failed to capture end screenshot for force-split:', error)
        }

        // Save current app info before finalize clears it
        const currentAppEvent: InteractionContext = {
          type: 'app_change',
          timestamp: boundaryTimestamp,
          displayId: this.currentActivityDisplayId,
          activeWindow: {
            title: this.currentActivity.windowTitle,
            processName: this.currentActivity.appName,
            bundleId: this.currentActivity.bundleId,
            url: this.currentActivity.url,
          },
        }

        await this.finalizeCurrentActivity(boundaryTimestamp)
        await this.startNewActivity(currentAppEvent, boundaryTimestamp)
      }
    }, ACTIVITY_CONFIG.FORCE_SPLIT_CHECK_INTERVAL_MS)
  }

  private stopPeriodicTimer(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer)
      this.periodicTimer = null
    }
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

  private getMonotonicBoundaryTimestamp(candidate: number, startTimestamp: number): number {
    if (candidate >= startTimestamp) return candidate
    log.warn(
      `[ActivityManager] Boundary timestamp ${candidate} is before start ${startTimestamp}, clamping`,
    )
    return startTimestamp
  }
}
