import { describe, expect, it } from 'vitest'
import type { InteractionContext } from '../shared/types'
import { createCaptureBlacklistCoordinator } from './capture-blacklist-coordinator'

function appChangeEvent(appName: string, bundleId?: string): InteractionContext {
  return {
    type: 'app_change',
    timestamp: Date.now(),
    activeWindow: {
      processName: appName,
      title: `${appName} window`,
      bundleId,
    },
  }
}

describe('capture blacklist coordinator', () => {
  it('suppresses screenshots and drops events while excluded app is active', () => {
    const forwarded: InteractionContext[] = []
    const suppressionTransitions: boolean[] = []
    let flushCount = 0

    const coordinator = createCaptureBlacklistCoordinator({
      initialExcludedApps: ['signal'],
      forwardInteraction: (event) => forwarded.push(event),
      flushEvents: () => {
        flushCount++
      },
      setScreenshotsSuppressed: (suppressed) => {
        suppressionTransitions.push(suppressed)
      },
    })

    coordinator.handleInteraction(appChangeEvent('Signal'))
    coordinator.handleInteraction({ type: 'keyboard', timestamp: Date.now(), keyCount: 3 })

    expect(flushCount).toBe(1)
    expect(suppressionTransitions).toEqual([true])
    expect(forwarded).toHaveLength(0)
  })

  it('resumes screenshots and forwards events when allowed app becomes active', () => {
    const forwarded: InteractionContext[] = []
    const suppressionTransitions: boolean[] = []

    const coordinator = createCaptureBlacklistCoordinator({
      initialExcludedApps: ['signal'],
      forwardInteraction: (event) => forwarded.push(event),
      flushEvents: () => undefined,
      setScreenshotsSuppressed: (suppressed) => {
        suppressionTransitions.push(suppressed)
      },
    })

    coordinator.handleInteraction(appChangeEvent('Signal'))
    const terminalEvent = appChangeEvent('Terminal')
    coordinator.handleInteraction(terminalEvent)

    expect(suppressionTransitions).toEqual([true, false])
    expect(forwarded).toEqual([terminalEvent])
  })

  it('reacts immediately when excluded app settings change', () => {
    const suppressionTransitions: boolean[] = []
    let flushCount = 0

    const coordinator = createCaptureBlacklistCoordinator({
      initialExcludedApps: [],
      forwardInteraction: () => undefined,
      flushEvents: () => {
        flushCount++
      },
      setScreenshotsSuppressed: (suppressed) => {
        suppressionTransitions.push(suppressed)
      },
    })

    coordinator.handleInteraction(appChangeEvent('KeePassXC'))
    coordinator.updateExcludedApps(['keepassxc'])

    expect(flushCount).toBe(1)
    expect(suppressionTransitions).toEqual([true])
  })
})
