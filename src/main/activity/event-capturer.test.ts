import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InteractionContext, EventWindow } from '@/shared/types'
import { InMemoryStream } from '@main/streams/in-memory-stream'
import type { StreamSubscription } from '@main/streams/stream'

// Use short timer values for fast tests
vi.mock('@constants', () => ({
  EVENT_CAPTURER_CONFIG: {
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

  it('closes with gap when the host reports idle', async () => {
    capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 1000 }))
    capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 1050 }))

    vi.advanceTimersByTime(300)
    await flushAsyncAppends()
    expect(windows).toHaveLength(0)

    capturer.closeIdle(1050)
    await flushAsyncAppends()

    expect(windows).toHaveLength(1)
    expect(windows[0].closedBy).toBe('gap')
    expect(windows[0].events).toHaveLength(2)
    expect(windows[0].startTimestamp).toBe(1000)
    expect(windows[0].endTimestamp).toBe(1050)
  })

  it('force-closes with max_duration when window exceeds max duration', async () => {
    capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 1000 }))
    for (let i = 1; i <= 10; i++) {
      vi.advanceTimersByTime(80)
      capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 1000 + i * 80 }))
    }
    await flushAsyncAppends()

    expect(windows).toHaveLength(1)
    expect(windows[0].closedBy).toBe('max_duration')

    capturer.closeIdle(1800)
    await flushAsyncAppends()
    expect(windows).toHaveLength(2)
  })

  it('retitles the window instead of splitting when typing retitles Notepad', async () => {
    const notepad = (title: string, timestamp: number): InteractionContext =>
      makeEvent({
        type: 'app_change',
        timestamp,
        activeWindow: { processName: 'Notepad', windowId: '0x1', title },
      })
    capturer.handleEvent(notepad('I - Notepad', 1000))
    capturer.handleEvent(makeEvent({ type: 'keyboard', timestamp: 1050 }))
    capturer.handleEvent(notepad('I n - Notepad', 1100))
    capturer.handleEvent(notepad('I ne - Notepad', 1150))
    capturer.handleEvent(notepad('*I ne - Notepad', 1200))
    capturer.handleEvent(notepad('other.txt - Notepad', 1300))
    await flushAsyncAppends()
    capturer.flush()
    await flushAsyncAppends()

    expect(windows.map((w) => w.events.map((e) => e.activeWindow?.title ?? e.type))).toEqual([
      ['*I ne - Notepad', 'keyboard'],
      ['other.txt - Notepad'],
    ])
  })

  it('splits on title insertions in other apps', async () => {
    capturer.handleEvent(
      makeEvent({
        type: 'app_change',
        timestamp: 1000,
        activeWindow: { processName: 'Slack', title: 'Slack' },
      }),
    )
    capturer.handleEvent(
      makeEvent({
        type: 'app_change',
        timestamp: 1100,
        activeWindow: { processName: 'Slack', title: '(3) Slack' },
      }),
    )
    await flushAsyncAppends()
    capturer.flush()
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
    capturer.closeIdle(Date.now())
    await flushAsyncAppends()

    // Second window
    capturer.handleEvent(makeEvent({ type: 'click', timestamp: 9000 }))
    capturer.closeIdle(Date.now())
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
    capturer.flush(11950)
    await flushAsyncAppends()

    expect(windows).toHaveLength(2)
    expect(windows[1].startTimestamp).toBe(12100)
    expect(windows[1].endTimestamp).toBe(12100)
    expect(windows[1].endTimestamp - windows[1].startTimestamp).toBeGreaterThanOrEqual(0)
  })
})

describe('EventCapturer idle and boundary ends', () => {
  let capturer: EventCapturer
  let stream: InMemoryStream<EventWindow>
  let windows: EventWindow[]
  let windowsSubscription: StreamSubscription

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
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

  it('keeps a no-input window open until idle and ends it at the last input', async () => {
    capturer.handleEvent(makeEvent({ type: 'app_change', timestamp: 1000 }))

    vi.advanceTimersByTime(300)
    await flushAsyncAppends()
    expect(windows).toHaveLength(0)

    capturer.closeIdle(1200)
    await flushAsyncAppends()

    expect(windows).toHaveLength(1)
    expect(windows[0].closedBy).toBe('gap')
    expect(windows[0].startTimestamp).toBe(1000)
    expect(windows[0].endTimestamp).toBe(1200)
    expect(windows[0].events).toHaveLength(1)
  })

  it('ends at the last event when idle began before it', async () => {
    capturer.handleEvent(makeEvent({ type: 'click', timestamp: 1000 }))

    capturer.closeIdle(900)
    await flushAsyncAppends()

    expect(windows).toHaveLength(1)
    expect(windows[0].endTimestamp).toBe(1000)
  })

  it('flush without a boundary ends at now', async () => {
    capturer.handleEvent(makeEvent({ type: 'click', timestamp: 1000 }))
    vi.setSystemTime(2000)

    capturer.flush()
    await flushAsyncAppends()

    expect(windows).toHaveLength(1)
    expect(windows[0].closedBy).toBe('flush')
    expect(windows[0].endTimestamp).toBe(2000)
  })

  it('flush with a boundary ends the window at the boundary', async () => {
    capturer.handleEvent(makeEvent({ type: 'click', timestamp: 1000 }))
    vi.setSystemTime(2000)

    capturer.flush(1300)
    await flushAsyncAppends()

    expect(windows).toHaveLength(1)
    expect(windows[0].endTimestamp).toBe(1300)
  })

  it('falls back to now when the close boundary is not finite', async () => {
    capturer.handleEvent(makeEvent({ type: 'click', timestamp: 1000 }))
    vi.setSystemTime(2000)

    capturer.handleEvent(makeEvent({ type: 'app_change', timestamp: NaN }))
    await flushAsyncAppends()

    expect(windows).toHaveLength(1)
    expect(windows[0].closedBy).toBe('app_change')
    expect(windows[0].endTimestamp).toBe(2000)
  })

  it('rolls over at max_duration and ends the next window at the last input', async () => {
    capturer.handleEvent(makeEvent({ type: 'app_change', timestamp: 1000 }))

    vi.advanceTimersByTime(500)
    await flushAsyncAppends()
    expect(windows).toHaveLength(1)
    expect(windows[0].closedBy).toBe('max_duration')
    expect(windows[0].endTimestamp).toBe(1500)

    vi.advanceTimersByTime(300)
    capturer.closeIdle(1650)
    await flushAsyncAppends()

    expect(windows).toHaveLength(2)
    expect(windows[1].closedBy).toBe('gap')
    expect(windows[1].startTimestamp).toBe(1500)
    expect(windows[1].endTimestamp).toBe(1650)
    expect(windows[1].events).toHaveLength(0)
  })

  it('drops a rolled-over window with no input after it opened', async () => {
    capturer.handleEvent(makeEvent({ type: 'app_change', timestamp: 1000 }))

    vi.advanceTimersByTime(500)
    capturer.closeIdle(1050)
    await flushAsyncAppends()

    expect(windows).toHaveLength(1)
    expect(windows[0].closedBy).toBe('max_duration')
  })

  it('does not open a window on app_change while away', async () => {
    capturer.handleEvent(makeEvent({ type: 'click', timestamp: 1000 }))
    capturer.closeIdle(1000)
    await flushAsyncAppends()
    expect(windows).toHaveLength(1)

    vi.setSystemTime(2000)
    capturer.handleEvent(makeEvent({ type: 'app_change', timestamp: 2000 }))
    vi.advanceTimersByTime(1500)
    await flushAsyncAppends()

    expect(windows).toHaveLength(1)
  })

  it('opens on the first input after away and carries the latest app_change as context', async () => {
    const screensaver = { title: '', processName: 'ScreenSaverEngine' }
    const chrome = { title: 'Inbox', processName: 'Google Chrome' }
    capturer.closeIdle(1000)
    capturer.handleEvent(
      makeEvent({ type: 'app_change', timestamp: 2000, activeWindow: screensaver }),
    )
    capturer.handleEvent(makeEvent({ type: 'app_change', timestamp: 3000, activeWindow: chrome }))

    vi.setSystemTime(5000)
    capturer.handleEvent(makeEvent({ type: 'click', timestamp: 5000 }))
    capturer.closeIdle(5000)
    await flushAsyncAppends()

    expect(windows).toHaveLength(1)
    expect(windows[0].startTimestamp).toBe(5000)
    expect(windows[0].endTimestamp).toBe(5000)
    expect(windows[0].events.map((event) => event.type)).toEqual(['app_change', 'click'])
    expect(windows[0].events[0].timestamp).toBe(5000)
    expect(windows[0].events[0].activeWindow).toEqual(chrome)
  })

  it('reopens on return at the return time with the away app_change as context', async () => {
    const chrome = { title: 'Inbox', processName: 'Google Chrome' }
    capturer.handleEvent(makeEvent({ type: 'click', timestamp: 1000 }))
    capturer.closeIdle(1000)
    await flushAsyncAppends()
    capturer.handleEvent(makeEvent({ type: 'app_change', timestamp: 2000, activeWindow: chrome }))

    capturer.openReturn(3000)
    capturer.closeIdle(3400)
    await flushAsyncAppends()

    expect(windows).toHaveLength(2)
    expect(windows[1].closedBy).toBe('gap')
    expect(windows[1].startTimestamp).toBe(3000)
    expect(windows[1].endTimestamp).toBe(3400)
    expect(windows[1].events).toHaveLength(1)
    expect(windows[1].events[0]).toMatchObject({
      type: 'app_change',
      timestamp: 3000,
      activeWindow: chrome,
    })
  })

  it('reopens on return without context and ends at the next idle', async () => {
    capturer.closeIdle(1000)

    capturer.openReturn(3000)
    capturer.closeIdle(3400)
    await flushAsyncAppends()

    expect(windows).toHaveLength(1)
    expect(windows[0].startTimestamp).toBe(3000)
    expect(windows[0].endTimestamp).toBe(3400)
    expect(windows[0].events).toHaveLength(0)
  })

  it('return keeps an already reopened window and ends the away state', async () => {
    capturer.closeIdle(1000)
    capturer.handleEvent(makeEvent({ type: 'click', timestamp: 2000 }))

    capturer.openReturn(2000)
    capturer.handleEvent(makeEvent({ type: 'app_change', timestamp: 2500 }))
    await flushAsyncAppends()

    expect(windows).toHaveLength(1)
    expect(windows[0].closedBy).toBe('app_change')
    expect(windows[0].startTimestamp).toBe(2000)
    expect(windows[0].endTimestamp).toBe(2500)
  })

  it('splits on app_change again once input has ended the away state', async () => {
    capturer.closeIdle(1000)
    capturer.handleEvent(makeEvent({ type: 'click', timestamp: 2000 }))
    capturer.handleEvent(makeEvent({ type: 'app_change', timestamp: 2500 }))
    await flushAsyncAppends()

    expect(windows).toHaveLength(1)
    expect(windows[0].closedBy).toBe('app_change')
    expect(windows[0].endTimestamp).toBe(2500)
  })
})
