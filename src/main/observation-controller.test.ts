import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppWatcherEvent } from './recorder/app-watcher'

type Listener = (event: AppWatcherEvent) => void

const listeners: Set<Listener> = new Set()

vi.mock('./recorder/app-watcher', () => ({
  addAppWatcherListener: (listener: Listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}))

vi.mock('./logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

function emit(event: AppWatcherEvent): void {
  for (const listener of [...listeners]) listener(event)
}

function makeEvent(partial: Partial<AppWatcherEvent>): AppWatcherEvent {
  return {
    type: 'app_change',
    timestamp: Date.now(),
    ...partial,
  }
}

describe('observation-controller', () => {
  beforeEach(() => {
    listeners.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('suppresses capture on start, restores on stop, and exposes collected apps/urls in lastRun', async () => {
    const { createObservationController } = await import('./observation-controller')

    const setFrameCaptureSuppressed = vi.fn()
    const onUpdate = vi.fn()

    const ctrl = createObservationController({
      captureControl: { setFrameCaptureSuppressed },
      onUpdate,
    })

    ctrl.start(60_000)
    expect(setFrameCaptureSuppressed).toHaveBeenNthCalledWith(1, true)

    emit(makeEvent({ bundleId: 'com.tinyspeck.slackmacgap' }))
    emit(makeEvent({ type: 'window_change', url: 'https://bank.example.com/account' }))
    emit(makeEvent({ bundleId: 'net.whatsapp.WhatsApp' }))
    emit(makeEvent({ bundleId: 'com.tinyspeck.slackmacgap' })) // duplicate — should not re-add

    ctrl.stop('user')

    expect(setFrameCaptureSuppressed).toHaveBeenNthCalledWith(2, false)

    const state = ctrl.getState()
    expect(state.phase).toBe('idle')
    expect(state.lastRun?.appsAdded).toBe(2)
    expect(state.lastRun?.urlsAdded).toBe(1)
    expect(state.lastRun?.apps).toEqual(expect.arrayContaining(['slackmacgap', 'whatsapp']))
    expect(state.lastRun?.urls).toEqual(['bank.example.com'])
  })

  it('filters browser-internal hosts (e.g. chrome://newtab/) from collected urls', async () => {
    const { createObservationController } = await import('./observation-controller')

    const ctrl = createObservationController({
      captureControl: { setFrameCaptureSuppressed: vi.fn() },
      onUpdate: vi.fn(),
    })

    ctrl.start(60_000)
    emit(makeEvent({ type: 'window_change', url: 'chrome://newtab/' }))
    emit(makeEvent({ type: 'window_change', url: 'https://bank.example.com/' }))
    ctrl.stop('user')

    const state = ctrl.getState()
    expect(state.lastRun?.urls).toEqual(['bank.example.com'])
    expect(state.lastRun?.urls).not.toContain('newtab')
  })

  it('skips browser apps but still collects their URLs', async () => {
    const { createObservationController } = await import('./observation-controller')

    const ctrl = createObservationController({
      captureControl: { setFrameCaptureSuppressed: vi.fn() },
      onUpdate: vi.fn(),
    })

    ctrl.start(60_000)
    emit(makeEvent({ bundleId: 'com.google.Chrome', url: 'https://docs.google.com/spreadsheets' }))
    emit(makeEvent({ bundleId: 'com.tinyspeck.slackmacgap' }))
    ctrl.stop('user')

    const state = ctrl.getState()
    expect(state.lastRun?.apps).not.toContain('chrome')
    expect(state.lastRun?.apps).toContain('slackmacgap')
    expect(state.lastRun?.urls).toEqual(['docs.google.com'])
  })

  it('auto-stops when the timer fires', async () => {
    const { createObservationController } = await import('./observation-controller')

    const setFrameCaptureSuppressed = vi.fn()

    const ctrl = createObservationController({
      captureControl: { setFrameCaptureSuppressed },
      onUpdate: vi.fn(),
    })

    ctrl.start(10_000)
    expect(ctrl.getState().phase).toBe('running')

    vi.advanceTimersByTime(10_000)

    expect(ctrl.getState().phase).toBe('idle')
    expect(setFrameCaptureSuppressed).toHaveBeenLastCalledWith(false)
    expect(ctrl.getState().lastRun).toBeDefined()
  })

  it('is idempotent: double start / double stop are no-ops', async () => {
    const { createObservationController } = await import('./observation-controller')

    const setFrameCaptureSuppressed = vi.fn()

    const ctrl = createObservationController({
      captureControl: { setFrameCaptureSuppressed },
      onUpdate: vi.fn(),
    })

    ctrl.start(30_000)
    ctrl.start(30_000) // ignored
    expect(setFrameCaptureSuppressed).toHaveBeenCalledTimes(1)

    ctrl.stop('user')
    const firstLastRunAt = ctrl.getState().lastRun?.at
    ctrl.stop('user') // ignored
    expect(setFrameCaptureSuppressed).toHaveBeenCalledTimes(2)
    expect(ctrl.getState().lastRun?.at).toBe(firstLastRunAt)
  })

  it('skips events originating from MemoryLane itself', async () => {
    const { createObservationController } = await import('./observation-controller')

    const ctrl = createObservationController({
      captureControl: { setFrameCaptureSuppressed: vi.fn() },
      onUpdate: vi.fn(),
    })

    ctrl.start(60_000)
    emit(makeEvent({ bundleId: 'dev.deusxmachina.memorylane' }))
    emit(makeEvent({ app: 'MemoryLane' }))
    ctrl.stop('user')

    const state = ctrl.getState()
    expect(state.lastRun?.apps).toEqual([])
    expect(state.lastRun?.urls).toEqual([])
  })

  it('clamps absurd durations', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const { createObservationController } = await import('./observation-controller')

    const ctrl = createObservationController({
      captureControl: { setFrameCaptureSuppressed: vi.fn() },
      onUpdate: vi.fn(),
    })

    const now = Date.now()

    ctrl.start(10) // below minimum
    expect(ctrl.getState().endsAt).not.toBeNull()
    expect(ctrl.getState().endsAt! - now).toBeGreaterThanOrEqual(5_000)
    ctrl.stop('user')

    ctrl.start(10 * 60 * 60_000) // above max
    expect(ctrl.getState().endsAt! - now).toBeLessThanOrEqual(30 * 60_000)
  })

  it('emits only on start/stop/collection-change (no tick broadcast)', async () => {
    const { createObservationController } = await import('./observation-controller')

    const onUpdate = vi.fn()

    const ctrl = createObservationController({
      captureControl: { setFrameCaptureSuppressed: vi.fn() },
      onUpdate,
    })

    ctrl.start(120_000)
    expect(onUpdate).toHaveBeenCalledTimes(1) // start

    vi.advanceTimersByTime(30_000) // no tick broadcast while idle
    expect(onUpdate).toHaveBeenCalledTimes(1)

    emit(makeEvent({ bundleId: 'com.tinyspeck.slackmacgap' }))
    expect(onUpdate).toHaveBeenCalledTimes(2) // change

    emit(makeEvent({ bundleId: 'com.tinyspeck.slackmacgap' })) // duplicate, no change
    expect(onUpdate).toHaveBeenCalledTimes(2)

    ctrl.stop('user')
    expect(onUpdate).toHaveBeenCalledTimes(3) // stop
  })
})
