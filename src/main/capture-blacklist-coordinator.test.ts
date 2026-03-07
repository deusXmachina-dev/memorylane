import { describe, expect, it } from 'vitest'
import type { InteractionContext } from '../shared/types'
import { createCaptureBlacklistCoordinator } from './capture-blacklist-coordinator'

function appChangeEvent(
  appName: string,
  options?: {
    title?: string
    bundleId?: string
    url?: string
  },
): InteractionContext {
  return {
    type: 'app_change',
    timestamp: Date.now(),
    activeWindow: {
      processName: appName,
      title: options?.title ?? `${appName} window`,
      bundleId: options?.bundleId,
      url: options?.url,
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

  it('suppresses screenshots for browser anonymous mode windows', () => {
    const forwarded: InteractionContext[] = []
    const suppressionTransitions: boolean[] = []
    let flushCount = 0

    const coordinator = createCaptureBlacklistCoordinator({
      initialExcludedApps: [],
      forwardInteraction: (event) => forwarded.push(event),
      flushEvents: () => {
        flushCount++
      },
      setScreenshotsSuppressed: (suppressed) => {
        suppressionTransitions.push(suppressed)
      },
    })

    coordinator.handleInteraction(
      appChangeEvent('Google Chrome', {
        title: 'New Incognito Tab - Google Chrome',
      }),
    )
    coordinator.handleInteraction({ type: 'keyboard', timestamp: Date.now(), keyCount: 2 })

    expect(flushCount).toBe(1)
    expect(suppressionTransitions).toEqual([true])
    expect(forwarded).toHaveLength(0)
  })

  it('resumes once browser leaves anonymous mode', () => {
    const forwarded: InteractionContext[] = []
    const suppressionTransitions: boolean[] = []

    const coordinator = createCaptureBlacklistCoordinator({
      initialExcludedApps: [],
      forwardInteraction: (event) => forwarded.push(event),
      flushEvents: () => undefined,
      setScreenshotsSuppressed: (suppressed) => {
        suppressionTransitions.push(suppressed)
      },
    })

    coordinator.handleInteraction(
      appChangeEvent('Microsoft Edge', {
        title: 'InPrivate - Microsoft Edge',
      }),
    )
    const normalEdgeWindow = appChangeEvent('Microsoft Edge', {
      title: 'MemoryLane docs - Microsoft Edge',
    })
    coordinator.handleInteraction(normalEdgeWindow)

    expect(suppressionTransitions).toEqual([true, false])
    expect(forwarded).toEqual([normalEdgeWindow])
  })

  it('does not suppress non-browser windows with private-like wording', () => {
    const forwarded: InteractionContext[] = []
    const suppressionTransitions: boolean[] = []

    const coordinator = createCaptureBlacklistCoordinator({
      initialExcludedApps: [],
      forwardInteraction: (event) => forwarded.push(event),
      flushEvents: () => undefined,
      setScreenshotsSuppressed: (suppressed) => {
        suppressionTransitions.push(suppressed)
      },
    })

    const terminalEvent = appChangeEvent('Terminal', {
      title: 'private browsing notes.md',
    })
    coordinator.handleInteraction(terminalEvent)

    expect(suppressionTransitions).toEqual([])
    expect(forwarded).toEqual([terminalEvent])
  })
})
