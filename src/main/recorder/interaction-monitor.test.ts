import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { INTERACTION_MONITOR_CONFIG } from '@constants'
import type { InteractionContext } from '../../shared/types'

// --- Mocks -----------------------------------------------------------------
// Defined via vi.hoisted so they are initialized before the hoisted vi.mock
// factories (and the top-level import of the module under test) run.

const { mockScreen, handlers, mockUiohook } = vi.hoisted(() => {
  const handlers: Record<string, (event: unknown) => void> = {}
  return {
    mockScreen: { getDisplayNearestPoint: vi.fn(() => ({ id: 1 })) },
    handlers,
    mockUiohook: {
      on: vi.fn((event: string, handler: (event: unknown) => void) => {
        handlers[event] = handler
      }),
      start: vi.fn(),
      stop: vi.fn(),
      removeAllListeners: vi.fn(),
    },
  }
})

vi.mock('electron', () => ({ screen: mockScreen }))
vi.mock('uiohook-napi', () => ({
  uIOhook: mockUiohook,
  UiohookMouseEvent: class {},
  UiohookWheelEvent: class {},
}))

vi.mock('./app-watcher', () => ({ addAppWatcherListener: vi.fn(() => () => {}) }))
vi.mock('./app-watcher-display', () => ({
  resolveAppWatcherDisplay: vi.fn(() => ({ displayId: 1, source: 'window' })),
}))
vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import * as monitor from './interaction-monitor'

// --- Helpers ---------------------------------------------------------------

function wheel(rotation = 1): void {
  handlers['wheel']?.({ rotation, direction: 3, x: 0, y: 0 })
}

function key(): void {
  handlers['keydown']?.({})
}

describe('interaction-monitor session emission', () => {
  // Registered once; the interaction-callback list is module-level and not
  // cleared by stop(), so we reuse a single buffer and reset it per test.
  const emitted: InteractionContext[] = []

  beforeAll(() => {
    monitor.onInteraction((c) => emitted.push(c))
  })

  beforeEach(() => {
    vi.clearAllMocks()
    for (const k of Object.keys(handlers)) delete handlers[k]
    vi.useFakeTimers()
    vi.setSystemTime(0)
    emitted.length = 0
    monitor.startInteractionMonitoring()
  })

  afterEach(() => {
    monitor.stopInteractionMonitoring()
    vi.useRealTimers()
  })

  it('emits interim events during a long continuous scroll (instead of one late event)', () => {
    // 20 wheel events, one every 500ms => 10s of continuous scrolling, which
    // exceeds MAX_SESSION_MS (4000) and the gap window several times over.
    for (let i = 0; i < 20; i++) {
      wheel(1)
      vi.advanceTimersByTime(500)
    }
    // Stop scrolling and let the debounce flush the final sub-window.
    vi.advanceTimersByTime(INTERACTION_MONITOR_CONFIG.SCROLL_DEBOUNCE_MS)

    // Old behavior emitted exactly one event at the very end; the fix emits
    // interim sub-windows so the downstream window stays alive.
    expect(emitted.length).toBeGreaterThan(1)
    expect(emitted.every((c) => c.type === 'scroll')).toBe(true)

    // An interim must land mid-session, well before the final emit.
    expect(emitted[0].timestamp).toBeLessThan(emitted[emitted.length - 1].timestamp)

    // Every raw event is accounted for exactly once across sub-windows
    // (accumulation resets per emit; nothing double-counted or dropped).
    const totalScroll = emitted.reduce((sum, c) => sum + (c.scrollAmount ?? 0), 0)
    expect(totalScroll).toBe(20)

    // Each sub-window carries a non-negative duration and a receipt-time stamp.
    for (const c of emitted) {
      expect(c.durationMs).toBeGreaterThanOrEqual(0)
      expect(c.timestamp).toBeGreaterThan(0)
      expect(c.scrollDirection).toBe('vertical')
    }
  })

  it('stamps a short scroll session at the last event receipt time', () => {
    vi.advanceTimersByTime(1000) // now = 1000
    wheel(3)
    vi.advanceTimersByTime(INTERACTION_MONITOR_CONFIG.SCROLL_DEBOUNCE_MS)

    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      type: 'scroll',
      timestamp: 1000, // receipt time of the only raw event
      scrollAmount: 3,
      durationMs: 0,
    })
  })

  it('honors a runtime debounce change without restart (config read lazily)', () => {
    const original = INTERACTION_MONITOR_CONFIG.SCROLL_DEBOUNCE_MS
    try {
      INTERACTION_MONITOR_CONFIG.SCROLL_DEBOUNCE_MS = 500
      vi.advanceTimersByTime(1000) // now = 1000
      wheel(2)
      // With the new 500ms debounce the final emit fires at 1500. If the value
      // were captured at construction (the regression), nothing emits here.
      vi.advanceTimersByTime(500)
      expect(emitted).toHaveLength(1)
      expect(emitted[0]).toMatchObject({ type: 'scroll', timestamp: 1000, scrollAmount: 2 })
    } finally {
      INTERACTION_MONITOR_CONFIG.SCROLL_DEBOUNCE_MS = original
    }
  })

  it('emits interim events during a long continuous typing session', () => {
    for (let i = 0; i < 20; i++) {
      key()
      vi.advanceTimersByTime(500)
    }
    vi.advanceTimersByTime(INTERACTION_MONITOR_CONFIG.TYPING_DEBOUNCE_MS)

    expect(emitted.length).toBeGreaterThan(1)
    expect(emitted.every((c) => c.type === 'keyboard')).toBe(true)
    const totalKeys = emitted.reduce((sum, c) => sum + (c.keyCount ?? 0), 0)
    expect(totalKeys).toBe(20)
  })

  it('cancels pending session timers on stop (no emit after stop)', () => {
    wheel(1) // opens a session with pending debounce + max-session timers
    monitor.stopInteractionMonitoring()
    vi.advanceTimersByTime(60_000)
    expect(emitted).toHaveLength(0)
  })
})
