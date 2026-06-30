import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InteractionContext, EventWindow } from '@/shared/types'
import { InMemoryStream } from '@main/streams/in-memory-stream'
import type { StreamSubscription } from '@main/streams/stream'

vi.mock('@constants', () => ({
  EVENT_CAPTURER_CONFIG: {
    GAP_TIMEOUT_MS: 100,
    MAX_WINDOW_DURATION_MS: 500,
    LATE_EVENT_GRACE_MS: 80,
  },
}))

vi.mock('@main/utils/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { EventCapturer } from './event-capturer'

function makeEvent(
  overrides: Partial<InteractionContext> & { type: InteractionContext['type']; timestamp: number },
): InteractionContext {
  return {
    ...overrides,
  }
}

async function flushAsyncAppends(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('EventCapturer late event handling', () => {
  let capturer: EventCapturer
  let stream: InMemoryStream<EventWindow>
  let windows: EventWindow[]
  let windowsSubscription: StreamSubscription

  beforeEach(() => {
    vi.useFakeTimers()
    stream = new InMemoryStream<EventWindow>()
    windows = []
    capturer = new EventCapturer(stream)
    windowsSubscription = stream.subscribe({
      startAt: { type: 'now' },
      onRecord: (record) => windows.push(record.payload),
    })
  })

  afterEach(() => {
    windowsSubscription.unsubscribe()
    capturer.destroy()
    vi.useRealTimers()
  })

  it('routes late debounced events into the previous app window before finalizing it', async () => {
    capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 1_000 }))

    // app_change closes the current window, but finalization waits for late arrivals
    capturer.handleEvent(
      makeEvent({
        type: 'app_change',
        timestamp: 2_000,
        activeWindow: { title: 'New App', processName: 'newapp' },
      }),
    )
    await flushAsyncAppends()
    expect(windows).toHaveLength(0)

    // Late event that occurred before app_change should be attached to previous window
    capturer.handleEvent(makeEvent({ type: 'click', timestamp: 1_700 }))

    vi.advanceTimersByTime(80)
    await flushAsyncAppends()
    expect(windows).toHaveLength(1)
    expect(windows[0].closedBy).toBe('app_change')
    expect(windows[0].events.map((event) => event.timestamp)).toEqual([1_000, 1_700])
    expect(windows[0].startTimestamp).toBe(1_000)
    expect(windows[0].endTimestamp).toBe(2_000)

    capturer.flush()
    await flushAsyncAppends()
    expect(windows).toHaveLength(2)
    expect(windows[1].closedBy).toBe('flush')
    expect(windows[1].events).toHaveLength(1)
    expect(windows[1].events[0].type).toBe('app_change')
    expect(windows[1].startTimestamp).toBe(2_000)
    expect(windows[1].endTimestamp).toBe(2_000)
  })

  it('emits windows in close order when capture stops while an earlier window is still in grace', async () => {
    const appOf = (window: EventWindow): string | undefined =>
      [...window.events].reverse().find((event) => event.activeWindow)?.activeWindow?.processName

    // W1 (Unknown): keyboard, closed by the switch to Ghostty.
    capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 1_000 }))
    capturer.handleEvent(
      makeEvent({
        type: 'app_change',
        timestamp: 2_000,
        activeWindow: { title: 'term', processName: 'ghostty' },
      }),
    )
    // Let W1 finalize through its grace so it has the lowest offset.
    vi.advanceTimersByTime(80)
    await flushAsyncAppends()
    expect(windows).toHaveLength(1)

    // W2 (Ghostty): scroll, then switch to Electron — closes W2 and starts its grace.
    capturer.handleEvent(makeEvent({ type: 'scroll', timestamp: 3_000 }))
    capturer.handleEvent(
      makeEvent({
        type: 'app_change',
        timestamp: 4_000,
        activeWindow: { title: 'MemoryLane', processName: 'electron' },
      }),
    )

    // Capture stops while W2 (Ghostty) is STILL in its late-event grace. The flush
    // window (Electron) must not jump ahead of the not-yet-finalized Ghostty window.
    capturer.flush()
    // Drain the async append chain (the fix emits both Ghostty and Electron here).
    for (let i = 0; i < 10 && windows.length < 3; i++) {
      vi.advanceTimersByTime(80)
      await flushAsyncAppends()
    }
    expect(windows).toHaveLength(3)

    const ghosttyIdx = windows.findIndex((window) => appOf(window) === 'ghostty')
    const electronIdx = windows.findIndex((window) => appOf(window) === 'electron')

    expect(ghosttyIdx).toBeGreaterThanOrEqual(0)
    expect(electronIdx).toBeGreaterThanOrEqual(0)
    // Ghostty (closed first) must be emitted before the Electron flush window, so
    // the producer processes it before Electron's frame-ack trims its frames.
    expect(ghosttyIdx).toBeLessThan(electronIdx)
  })
})
