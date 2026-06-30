import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InteractionContext, EventWindow } from '@/shared/types'
import { InMemoryStream } from '@main/streams/in-memory-stream'
import type { StreamSubscription } from '@main/streams/stream'

// Use short timer values for fast tests
vi.mock('@constants', () => ({
  EVENT_CAPTURER_CONFIG: {
    GAP_TIMEOUT_MS: 100,
    MAX_WINDOW_DURATION_MS: 500,
  },
}))

// Stub logger to avoid electron-log import in test environment
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
  overrides: Partial<InteractionContext> & { type: InteractionContext['type'] },
): InteractionContext {
  return {
    timestamp: Date.now(),
    ...overrides,
  }
}

async function flushAsyncAppends(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('EventCapturer', () => {
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

  it('emits a window via gap closure after inactivity', async () => {
    capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 1000 }))
    capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 1050 }))

    expect(windows).toHaveLength(0)

    // Advance past gap timeout (100ms mock)
    vi.advanceTimersByTime(100)
    await flushAsyncAppends()

    expect(windows).toHaveLength(1)
    expect(windows[0].closedBy).toBe('gap')
    expect(windows[0].events).toHaveLength(2)
    expect(windows[0].startTimestamp).toBe(1000)
    expect(windows[0].endTimestamp).toBe(1050)
  })

  it('force-closes with max_duration when window exceeds max duration', async () => {
    // Feed events continuously to keep the gap timer resetting
    capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 1000 }))
    for (let i = 1; i <= 10; i++) {
      vi.advanceTimersByTime(80) // less than gap timeout (100ms)
      capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 1000 + i * 80 }))
    }
    await flushAsyncAppends()

    // At this point ~800ms has passed. Max duration is 500ms, so the timer should
    // have fired at 500ms. The window should have been closed then.
    expect(windows).toHaveLength(1)
    expect(windows[0].closedBy).toBe('max_duration')

    // The events after max_duration fired opened a new window
    // Advance past gap timeout to close that second window
    vi.advanceTimersByTime(100)
    await flushAsyncAppends()
    expect(windows).toHaveLength(2)
  })

  it('emits with flush when flush() is called', async () => {
    capturer.handleEvent(makeEvent({ type: 'click', timestamp: 2000 }))
    capturer.flush()
    await flushAsyncAppends()

    expect(windows).toHaveLength(1)
    expect(windows[0].closedBy).toBe('flush')
    expect(windows[0].events).toHaveLength(1)
  })

  it('flush is a no-op when no window is open', async () => {
    capturer.flush()
    await flushAsyncAppends()

    expect(windows).toHaveLength(0)
  })

  it('destroy discards open window without emitting', async () => {
    capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 3000 }))
    capturer.destroy()

    // Advance timers to ensure no delayed callbacks fire
    vi.advanceTimersByTime(1000)
    await flushAsyncAppends()

    expect(windows).toHaveLength(0)
  })

  it('does not open a window until the first event', async () => {
    // No events -> flush is no-op
    capturer.flush()
    await flushAsyncAppends()
    expect(windows).toHaveLength(0)

    // Advance timers — still nothing
    vi.advanceTimersByTime(1000)
    await flushAsyncAppends()
    expect(windows).toHaveLength(0)
  })

  it('supports stream subscriptions and unsubscribe', async () => {
    const windowsA: EventWindow[] = []
    const windowsB: EventWindow[] = []
    const subA = stream.subscribe({
      startAt: { type: 'now' },
      onRecord: (record) => windowsA.push(record.payload),
    })
    const subB = stream.subscribe({
      startAt: { type: 'now' },
      onRecord: (record) => windowsB.push(record.payload),
    })

    capturer.handleEvent(makeEvent({ type: 'click', timestamp: 4000 }))
    capturer.flush()
    await flushAsyncAppends()

    expect(windowsA).toHaveLength(1)
    expect(windowsB).toHaveLength(1)

    subA.unsubscribe()

    capturer.handleEvent(makeEvent({ type: 'click', timestamp: 5000 }))
    capturer.flush()
    await flushAsyncAppends()

    expect(windowsA).toHaveLength(1)
    expect(windowsB).toHaveLength(2)
    subB.unsubscribe()
  })

  it('isolates subscriber errors — one throwing subscriber does not break others', async () => {
    const successfulWindows: EventWindow[] = []
    const throwingSub = stream.subscribe({
      startAt: { type: 'now' },
      onRecord: () => {
        throw new Error('boom')
      },
    })
    const successfulSub = stream.subscribe({
      startAt: { type: 'now' },
      onRecord: (record) => successfulWindows.push(record.payload),
    })

    capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 6000 }))
    capturer.flush()
    await flushAsyncAppends()

    expect(successfulWindows).toHaveLength(1)
    throwingSub.unsubscribe()
    successfulSub.unsubscribe()
  })

  it('preserves event insertion order in the emitted window', async () => {
    const events = [
      makeEvent({ type: 'keyboard', timestamp: 7000 }),
      makeEvent({ type: 'click', timestamp: 7010 }),
      makeEvent({ type: 'scroll', timestamp: 7020 }),
    ]

    for (const e of events) {
      capturer.handleEvent(e)
    }
    capturer.flush()
    await flushAsyncAppends()

    expect(windows[0].events).toHaveLength(3)
    expect(windows[0].events[0].type).toBe('keyboard')
    expect(windows[0].events[1].type).toBe('click')
    expect(windows[0].events[2].type).toBe('scroll')
  })

  it('produces multiple consecutive windows with unique ids', async () => {
    // First window
    capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 8000 }))
    vi.advanceTimersByTime(100) // gap close
    await flushAsyncAppends()

    // Second window
    capturer.handleEvent(makeEvent({ type: 'click', timestamp: 9000 }))
    vi.advanceTimersByTime(100) // gap close
    await flushAsyncAppends()

    expect(windows).toHaveLength(2)
    expect(windows[0].id).not.toBe(windows[1].id)
    expect(windows[0].closedBy).toBe('gap')
    expect(windows[1].closedBy).toBe('gap')
    expect(windows[0].startTimestamp).toBe(8000)
    expect(windows[1].startTimestamp).toBe(9000)
  })

  it('splits window on app_change — previous window emitted, app_change becomes first event of new window', async () => {
    capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 10000 }))
    capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 10050 }))

    // App change splits the window
    capturer.handleEvent(
      makeEvent({
        type: 'app_change',
        timestamp: 10100,
        activeWindow: { title: 'New App', processName: 'newapp' },
        previousWindow: { title: 'Old App', processName: 'oldapp' },
      }),
    )
    await flushAsyncAppends()

    // First window should have been emitted with the keyboard events
    expect(windows).toHaveLength(1)
    expect(windows[0].closedBy).toBe('app_change')
    expect(windows[0].events).toHaveLength(2)
    expect(windows[0].events[0].type).toBe('keyboard')
    expect(windows[0].events[1].type).toBe('keyboard')
    expect(windows[0].endTimestamp).toBe(10100)

    // The app_change event is in a new (still open) window — flush to verify
    capturer.flush()
    await flushAsyncAppends()

    expect(windows).toHaveLength(2)
    expect(windows[1].closedBy).toBe('flush')
    expect(windows[1].events).toHaveLength(1)
    expect(windows[1].events[0].type).toBe('app_change')
    expect(windows[1].startTimestamp).toBe(10100)
  })

  it('keeps non-negative duration when a late event timestamp is older than new app_change window start', async () => {
    capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 12000 }))
    capturer.handleEvent(makeEvent({ type: 'app_change', timestamp: 12100 }))
    await flushAsyncAppends()

    // New window starts at app_change boundary (12100), then we receive a late/backdated
    // event that should be routed into the prior pending window.
    capturer.handleEvent(makeEvent({ type: 'scroll', timestamp: 11900 }))
    capturer.flush()
    await flushAsyncAppends()

    expect(windows).toHaveLength(2)
    expect(windows[1].startTimestamp).toBe(12100)
    expect(windows[1].endTimestamp).toBe(12100)
    expect(windows[1].endTimestamp - windows[1].startTimestamp).toBeGreaterThanOrEqual(0)
  })

  it('gap timer resets on each event', async () => {
    capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 11000 }))

    // Advance 80ms (less than 100ms gap) and feed another event
    vi.advanceTimersByTime(80)
    capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 11080 }))

    // Advance another 80ms — should not close yet (gap restarted)
    vi.advanceTimersByTime(80)
    await flushAsyncAppends()
    expect(windows).toHaveLength(0)

    // Advance remaining 20ms to hit 100ms after last event
    vi.advanceTimersByTime(20)
    await flushAsyncAppends()
    expect(windows).toHaveLength(1)
    expect(windows[0].events).toHaveLength(2)
  })
})
