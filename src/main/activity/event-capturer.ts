import { v4 as uuidv4 } from 'uuid'
import { EVENT_CAPTURER_CONFIG } from '@constants'
import { EventWindow, InteractionContext } from '@/shared/types'
import log from '@main/utils/logger'
import type { DurableStream } from '@main/streams/stream'

interface PendingWindow {
  id: string
  startTimestamp: number
  events: InteractionContext[]
  closedBy: EventWindow['closedBy']
  boundaryTimestamp: number
  includeBoundaryTimestamp: boolean
  endTimestampOverride?: number
  lastInputAt: number
  finalizeTimer: NodeJS.Timeout | null
}

interface CloseWindowOptions {
  boundaryTimestamp?: number
  includeBoundaryTimestamp?: boolean
  waitForLateEvents?: boolean
  lastInputAt?: number
}

export class EventCapturer {
  private readonly eventStream: DurableStream<EventWindow>
  private readonly lateEventGraceMs: number

  private appendChain: Promise<void> = Promise.resolve()

  private currentWindow: {
    id: string
    startTimestamp: number
    events: InteractionContext[]
  } | null = null

  /**
   * Candidate start for the next window.
   * Only app_change sets this value so the new window starts exactly at the
   * switch boundary. Other close reasons open at the next observed event.
   */
  private nextWindowStartTimestamp: number | null = null
  private away = false
  private awayContext: InteractionContext | null = null
  private pendingWindows: PendingWindow[] = []

  private maxDurationTimer: NodeJS.Timeout | null = null

  constructor(eventStream: DurableStream<EventWindow>) {
    this.eventStream = eventStream
    this.lateEventGraceMs = EVENT_CAPTURER_CONFIG.LATE_EVENT_GRACE_MS ?? 0
  }

  handleEvent(event: InteractionContext): void {
    if (event.type === 'app_change') {
      if (this.away) {
        this.awayContext = event
        return
      }
      if (this.currentWindow !== null) {
        this.closeWindow('app_change', {
          boundaryTimestamp: event.timestamp,
          includeBoundaryTimestamp: false,
        })
      }
    } else if (this.tryAttachToPendingWindow(event)) {
      return
    }

    if (this.currentWindow === null) {
      this.currentWindow = this.openWindow(this.nextWindowStartTimestamp ?? event.timestamp)
      this.nextWindowStartTimestamp = null
      if (this.awayContext !== null) {
        this.currentWindow.events.push({ ...this.awayContext, timestamp: event.timestamp })
        this.awayContext = null
      }
    }

    this.away = false
    this.currentWindow.events.push(event)
  }

  closeIdle(lastInputAt: number): void {
    this.away = true
    if (this.currentWindow === null) return
    this.closeWindow('gap', { lastInputAt })
  }

  flush(boundaryTimestamp?: number): void {
    if (this.currentWindow === null) return
    this.closeWindow('flush', {
      waitForLateEvents: false,
      boundaryTimestamp,
    })
  }

  async waitForIdle(): Promise<void> {
    let idle = false
    while (!idle) {
      const chain = this.appendChain
      await chain
      idle = this.pendingWindows.length === 0 && chain === this.appendChain
      if (!idle) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    }
  }

  async flushAndWait(): Promise<void> {
    this.flush()
    this.finalizeAllPendingWindows()
    await this.waitForIdle()
  }

  /**
   * Hard cleanup — clears all timers and discards any open window WITHOUT
   * emitting. Used on app quit where we don't need the partial data.
   */
  destroy(): void {
    if (this.maxDurationTimer !== null) {
      clearTimeout(this.maxDurationTimer)
      this.maxDurationTimer = null
    }
    this.currentWindow = null
    this.nextWindowStartTimestamp = null
    this.away = false
    this.awayContext = null
    this.clearPendingWindows()
  }

  /**
   * Close the current window with the given reason, build the EventWindow,
   * enqueue it for async stream append, and reset state for the next window.
   */
  private closeWindow(reason: EventWindow['closedBy'], options?: CloseWindowOptions): void {
    if (this.currentWindow === null) return

    if (this.maxDurationTimer !== null) {
      clearTimeout(this.maxDurationTimer)
      this.maxDurationTimer = null
    }

    const requestedBoundary = options?.boundaryTimestamp
    const boundaryTimestamp =
      requestedBoundary !== undefined && Number.isFinite(requestedBoundary)
        ? requestedBoundary
        : Date.now()
    const { startTimestamp, events } = this.currentWindow
    const lastInputAt = options?.lastInputAt ?? boundaryTimestamp
    if (events.length === 0 && lastInputAt <= startTimestamp) {
      this.currentWindow = null
      this.nextWindowStartTimestamp = null
      return
    }

    const pendingWindow: PendingWindow = {
      id: this.currentWindow.id,
      startTimestamp: this.currentWindow.startTimestamp,
      events: [...this.currentWindow.events],
      closedBy: reason,
      boundaryTimestamp,
      includeBoundaryTimestamp: options?.includeBoundaryTimestamp ?? true,
      endTimestampOverride: reason === 'app_change' ? boundaryTimestamp : undefined,
      lastInputAt,
      finalizeTimer: null,
    }

    this.currentWindow = null
    this.nextWindowStartTimestamp = reason === 'app_change' ? boundaryTimestamp : null

    const shouldWaitForLateEvents = options?.waitForLateEvents ?? true
    const finalizeDelayMs = shouldWaitForLateEvents ? this.lateEventGraceMs : 0
    this.schedulePendingWindowFinalize(pendingWindow, finalizeDelayMs)
  }

  private openWindow(startTimestamp: number): NonNullable<EventCapturer['currentWindow']> {
    this.startMaxDurationTimer()
    return { id: uuidv4(), startTimestamp, events: [] }
  }

  private startMaxDurationTimer(): void {
    this.maxDurationTimer = setTimeout(() => {
      this.maxDurationTimer = null
      const boundaryTimestamp = Date.now()
      this.closeWindow('max_duration', { boundaryTimestamp })
      this.currentWindow = this.openWindow(boundaryTimestamp)
    }, EVENT_CAPTURER_CONFIG.MAX_WINDOW_DURATION_MS)
  }

  private tryAttachToPendingWindow(event: InteractionContext): boolean {
    for (let i = this.pendingWindows.length - 1; i >= 0; i--) {
      const pendingWindow = this.pendingWindows[i]
      const withinBoundary = pendingWindow.includeBoundaryTimestamp
        ? event.timestamp <= pendingWindow.boundaryTimestamp
        : event.timestamp < pendingWindow.boundaryTimestamp

      if (!withinBoundary) continue

      pendingWindow.events.push(event)
      return true
    }

    return false
  }

  private schedulePendingWindowFinalize(pendingWindow: PendingWindow, delayMs: number): void {
    this.pendingWindows.push(pendingWindow)

    if (delayMs <= 0) {
      this.finalizePendingWindowById(pendingWindow.id)
      return
    }

    pendingWindow.finalizeTimer = setTimeout(() => {
      pendingWindow.finalizeTimer = null
      this.finalizePendingWindowById(pendingWindow.id)
    }, delayMs)
  }

  private finalizeAllPendingWindows(): void {
    while (this.pendingWindows.length > 0) {
      this.finalizePendingWindowById(this.pendingWindows[0].id)
    }
  }

  private finalizePendingWindowById(windowId: string): void {
    const index = this.pendingWindows.findIndex((window) => window.id === windowId)
    if (index < 0) return

    // Finalize this window AND every earlier still-pending one, oldest first, so
    // windows always reach the stream in close (chronological) order. Otherwise a
    // window finalized with no grace delay — e.g. the flush window on
    // capture-stop — can jump ahead of an earlier app_change window still in its
    // late-event grace. The producer would then process the later window first
    // and advance its frame ack past the earlier window's range, dropping that
    // earlier window for "no frames" even though it had screenshots.
    for (let i = 0; i <= index; i++) {
      const pendingWindow = this.pendingWindows.shift()
      if (pendingWindow === undefined) break
      this.emitPendingWindow(pendingWindow)
    }
  }

  private emitPendingWindow(pendingWindow: PendingWindow): void {
    if (pendingWindow.finalizeTimer !== null) {
      clearTimeout(pendingWindow.finalizeTimer)
      pendingWindow.finalizeTimer = null
    }

    const bounds = this.computeWindowBounds(pendingWindow)
    const window: EventWindow = {
      id: pendingWindow.id,
      startTimestamp: bounds.startTimestamp,
      endTimestamp: bounds.endTimestamp,
      events: pendingWindow.events,
      closedBy: pendingWindow.closedBy,
    }

    log.debug(
      `[EventCapturer] Window closed (${window.closedBy}): ${window.events.length} events, ` +
        `${window.endTimestamp - window.startTimestamp}ms`,
    )
    this.enqueueWindow(window)
  }

  private computeWindowBounds(window: {
    startTimestamp: number
    events: InteractionContext[]
    endTimestampOverride?: number
    lastInputAt: number
  }): {
    startTimestamp: number
    endTimestamp: number
  } {
    if (window.endTimestampOverride !== undefined) {
      return {
        startTimestamp: window.startTimestamp,
        endTimestamp: Math.max(window.startTimestamp, window.endTimestampOverride),
      }
    }

    const timestamps = window.events
      .map((event) => event.timestamp)
      .filter((timestamp) => Number.isFinite(timestamp))
    timestamps.push(window.lastInputAt)
    if (timestamps.length === 0) {
      return {
        startTimestamp: window.startTimestamp,
        endTimestamp: window.startTimestamp,
      }
    }

    const maxTimestamp = Math.max(...timestamps)
    return {
      startTimestamp: window.startTimestamp,
      endTimestamp: Math.max(window.startTimestamp, maxTimestamp),
    }
  }

  private clearPendingWindows(): void {
    for (const window of this.pendingWindows) {
      if (window.finalizeTimer !== null) {
        clearTimeout(window.finalizeTimer)
      }
    }
    this.pendingWindows = []
  }

  private enqueueWindow(window: EventWindow): void {
    const appendTask = this.appendChain.then(() => this.eventStream.append(window))

    this.appendChain = appendTask
      .then(() => undefined)
      .catch((err) => {
        log.error('[EventCapturer] Stream append failed:', err)
      })
  }
}
