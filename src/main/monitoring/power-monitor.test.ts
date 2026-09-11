import type { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as PowerMonitorModule from './power-monitor'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  const powerMonitor = Object.assign(new EventEmitter(), {
    isOnBatteryPower: () => false,
    getSystemIdleTime: () => 0,
  })
  return { powerMonitor }
})
vi.mock('@main/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

describe('power monitor suspend tracking', () => {
  let emitter: EventEmitter
  let pm: typeof PowerMonitorModule

  beforeEach(async () => {
    vi.resetModules()
    emitter = (await import('electron')).powerMonitor as unknown as EventEmitter
    pm = await import('./power-monitor')
    pm.startPowerMonitoring({ onPause: () => {}, onResume: () => {} })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts awake with no suspend recorded', () => {
    expect(pm.isSuspended()).toBe(false)
    expect(pm.getLastSuspendAt()).toBe(0)
  })

  it('suspend sets the flag and records when it happened', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-10T07:03:30Z'))
    emitter.emit('suspend')
    expect(pm.isSuspended()).toBe(true)
    expect(pm.getLastSuspendAt()).toBe(Date.parse('2026-09-10T07:03:30Z'))
  })

  it('resume clears the flag but keeps the suspend time', () => {
    emitter.emit('suspend')
    const at = pm.getLastSuspendAt()
    emitter.emit('resume')
    expect(pm.isSuspended()).toBe(false)
    expect(pm.getLastSuspendAt()).toBe(at)
  })
})
