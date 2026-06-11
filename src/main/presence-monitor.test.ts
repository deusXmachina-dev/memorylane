import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PresenceMonitor, type PresenceMonitorDeps } from './presence-monitor'
import { EVENT_CAPTURER_CONFIG, PRESENCE_MONITOR_CONFIG } from '../shared/constants'

vi.mock('./logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const CONFIG = { heartbeatIntervalMs: 4000, awayIdleSeconds: 90 }

function makeDeps(overrides: Partial<PresenceMonitorDeps> = {}): {
  deps: PresenceMonitorDeps
  emit: ReturnType<typeof vi.fn>
} {
  const emit = vi.fn()
  const deps: PresenceMonitorDeps = {
    emit,
    isPaused: () => false,
    getIdleSeconds: () => 10,
    now: () => 5000,
    ...overrides,
  }
  return { deps, emit }
}

describe('PresenceMonitor', () => {
  describe('tick', () => {
    it('emits a bare presence heartbeat when the user is present', () => {
      const { deps, emit } = makeDeps()
      new PresenceMonitor(deps, CONFIG).tick()

      expect(emit).toHaveBeenCalledTimes(1)
      expect(emit).toHaveBeenCalledWith({ type: 'presence', timestamp: 5000 })
    })

    it('does not emit while paused (screen locked / suspended)', () => {
      const { deps, emit } = makeDeps({ isPaused: () => true })
      new PresenceMonitor(deps, CONFIG).tick()
      expect(emit).not.toHaveBeenCalled()
    })

    it('does not emit once idle reaches the away threshold (walked away)', () => {
      const { deps, emit } = makeDeps({ getIdleSeconds: () => 90 })
      new PresenceMonitor(deps, CONFIG).tick()
      expect(emit).not.toHaveBeenCalled()
    })

    it('still emits just under the away threshold', () => {
      const { deps, emit } = makeDeps({ getIdleSeconds: () => 89 })
      new PresenceMonitor(deps, CONFIG).tick()
      expect(emit).toHaveBeenCalledTimes(1)
    })
  })

  describe('start/stop', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('ticks on the configured cadence until stopped', () => {
      const { deps, emit } = makeDeps()
      const monitor = new PresenceMonitor(deps, CONFIG)

      monitor.start()
      vi.advanceTimersByTime(CONFIG.heartbeatIntervalMs * 3)
      expect(emit).toHaveBeenCalledTimes(3)

      monitor.stop()
      vi.advanceTimersByTime(CONFIG.heartbeatIntervalMs * 5)
      expect(emit).toHaveBeenCalledTimes(3)
    })

    it('start is idempotent (no double scheduling)', () => {
      const { deps, emit } = makeDeps()
      const monitor = new PresenceMonitor(deps, CONFIG)

      monitor.start()
      monitor.start()
      vi.advanceTimersByTime(CONFIG.heartbeatIntervalMs)
      expect(emit).toHaveBeenCalledTimes(1)
      monitor.stop()
    })
  })

  it('heartbeats faster than the event gap so a read window never dies between beats', () => {
    // The binding invariant: a heartbeat must land before the idle gap fires.
    expect(PRESENCE_MONITOR_CONFIG.HEARTBEAT_INTERVAL_MS).toBeLessThan(
      EVENT_CAPTURER_CONFIG.GAP_TIMEOUT_MS,
    )
  })
})
