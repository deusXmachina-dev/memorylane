import type { InteractionContext } from '@/shared/types'
import { PRESENCE_MONITOR_CONFIG } from '@constants'
import log from '@main/utils/logger'

export interface PresenceMonitorConfig {
  heartbeatIntervalMs: number
  awayIdleSeconds: number
}

export interface PresenceMonitorDeps {
  /** Forward a synthetic presence event into the capture pipeline. */
  emit: (event: InteractionContext) => void
  /** True while capture should be paused (screen locked / system suspended). */
  isPaused: () => boolean
  /** Seconds since the last system-wide input (mouse movement counts). */
  getIdleSeconds: () => number
  /** Current wall-clock time in ms; injectable for tests. */
  now?: () => number
}

/**
 * Emits a `presence` heartbeat on a fixed cadence while the user is at the
 * machine but not providing input, so a no-input view (reading) keeps its event
 * window alive instead of dying at the EventCapturer's idle gap.
 *
 * The heartbeat stops — letting the gap close the window at the user's last
 * present moment — when the screen locks/suspends or when the OS reports more
 * than `awayIdleSeconds` without input. Because mouse movement resets the OS
 * idle timer, a present reader keeps the window alive without clicking anything,
 * while a genuine walk-away is cut shortly after their last movement.
 *
 * The heartbeat is a bare event: it carries no window context (the read's
 * app/title comes from the window's own app_change) and nothing sensitive, so
 * it's emitted directly to the pipeline as a peer event source.
 */
export class PresenceMonitor {
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly now: () => number

  constructor(
    private readonly deps: PresenceMonitorDeps,
    private readonly config: PresenceMonitorConfig = {
      heartbeatIntervalMs: PRESENCE_MONITOR_CONFIG.HEARTBEAT_INTERVAL_MS,
      awayIdleSeconds: PRESENCE_MONITOR_CONFIG.AWAY_IDLE_SECONDS,
    },
  ) {
    this.now = deps.now ?? Date.now
  }

  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => this.tick(), this.config.heartbeatIntervalMs)
    log.debug(
      `[Presence] Heartbeat started (every ${this.config.heartbeatIntervalMs}ms, ` +
        `away after ${this.config.awayIdleSeconds}s idle)`,
    )
  }

  stop(): void {
    if (this.timer === null) return
    clearInterval(this.timer)
    this.timer = null
    log.debug('[Presence] Heartbeat stopped')
  }

  /** Evaluate presence once and emit a heartbeat if the user is present. Exposed for tests. */
  tick(): void {
    if (this.deps.isPaused()) return
    if (this.deps.getIdleSeconds() >= this.config.awayIdleSeconds) return

    this.deps.emit({ type: 'presence', timestamp: this.now() })
  }
}
