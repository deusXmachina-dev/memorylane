import { describe, expect, it } from 'vitest'
import type { InteractionContext } from '@/shared/types'
import { createCaptureBlacklistCoordinator } from './capture-blacklist-coordinator'

function appChangeEvent(
  appName: string,
  options?: {
    hwnd?: string
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
      hwnd: options?.hwnd,
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

  it('emits privacy blocking transitions when entering and leaving blocked state', () => {
    const privacyTransitions: boolean[] = []

    const coordinator = createCaptureBlacklistCoordinator({
      initialExcludedApps: ['signal'],
      onPrivacyBlockingChanged: (blocked) => privacyTransitions.push(blocked),
      forwardInteraction: () => undefined,
      flushEvents: () => undefined,
      setScreenshotsSuppressed: () => undefined,
    })

    coordinator.handleInteraction(appChangeEvent('Signal'))
    coordinator.handleInteraction(appChangeEvent('Terminal'))

    expect(privacyTransitions).toEqual([true, false])
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
    coordinator.updateExclusions({
      apps: ['keepassxc'],
      urlPatterns: [],
      excludePrivateBrowsing: true,
    })

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

  it('keeps anonymous suppression for the same windows hwnd after title/url changes', () => {
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
      appChangeEvent('chrome', {
        hwnd: '0x6B0A0A',
        title: 'New Incognito tab - Google Chrome',
      }),
    )
    coordinator.handleInteraction(
      appChangeEvent('chrome', {
        hwnd: '0x6B0A0A',
        title: 'Seznam - Google Chrome',
        url: 'https://seznam.cz',
      }),
    )
    const normalChromeWindow = appChangeEvent('chrome', {
      hwnd: '0x10770',
      title: 'MemoryLane docs - Google Chrome',
      url: 'https://trymemorylane.com',
    })
    coordinator.handleInteraction(normalChromeWindow)

    expect(flushCount).toBe(1)
    expect(suppressionTransitions).toEqual([true, false])
    expect(forwarded).toEqual([normalChromeWindow])
  })

  it('does not suppress anonymous browser windows when private browsing exclusion is disabled', () => {
    const forwarded: InteractionContext[] = []
    const suppressionTransitions: boolean[] = []

    const coordinator = createCaptureBlacklistCoordinator({
      initialExcludedApps: [],
      initialExcludePrivateBrowsing: false,
      forwardInteraction: (event) => forwarded.push(event),
      flushEvents: () => undefined,
      setScreenshotsSuppressed: (suppressed) => {
        suppressionTransitions.push(suppressed)
      },
    })

    const incognitoEdgeWindow = appChangeEvent('Microsoft Edge', {
      title: 'InPrivate - Microsoft Edge',
    })
    coordinator.handleInteraction(incognitoEdgeWindow)

    expect(suppressionTransitions).toEqual([])
    expect(forwarded).toEqual([incognitoEdgeWindow])
  })

  it('clears sticky anonymous hwnd suppression when private browsing exclusion is disabled', () => {
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
      appChangeEvent('chrome', {
        hwnd: '0x6B0A0A',
        title: 'New Incognito tab - Google Chrome',
      }),
    )

    coordinator.updateExclusions({
      apps: [],
      urlPatterns: [],
      excludePrivateBrowsing: false,
    })

    const sameWindowAfterDisable = appChangeEvent('chrome', {
      hwnd: '0x6B0A0A',
      title: 'Seznam - Google Chrome',
      url: 'https://seznam.cz',
    })
    coordinator.handleInteraction(sameWindowAfterDisable)

    expect(suppressionTransitions).toEqual([true, false])
    expect(forwarded).toEqual([sameWindowAfterDisable])
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

  it('enforces org-managed app exclusions immediately when synced', () => {
    const suppressionTransitions: boolean[] = []

    const coordinator = createCaptureBlacklistCoordinator({
      initialExcludedApps: [],
      forwardInteraction: () => undefined,
      flushEvents: () => undefined,
      setScreenshotsSuppressed: (suppressed) => {
        suppressionTransitions.push(suppressed)
      },
    })

    coordinator.handleInteraction(appChangeEvent('Slack'))
    coordinator.setManagedExclusions({ apps: ['Slack'], urlPatterns: [] })

    expect(suppressionTransitions).toEqual([true])
  })

  it('keeps managed exclusions enforced across a user settings change (union of both layers)', () => {
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

    coordinator.setManagedExclusions({ apps: ['slack'], urlPatterns: [] })

    // A later user settings save (no Slack) must not drop the managed entry.
    coordinator.updateExclusions({
      apps: ['signal'],
      urlPatterns: [],
      excludePrivateBrowsing: true,
    })

    coordinator.handleInteraction(appChangeEvent('Slack'))
    expect(suppressionTransitions).toEqual([true])
    expect(forwarded).toHaveLength(0)
  })

  it('suppresses screenshots when url matches excluded wildcard', () => {
    const forwarded: InteractionContext[] = []
    const suppressionTransitions: boolean[] = []
    let flushCount = 0

    const coordinator = createCaptureBlacklistCoordinator({
      initialExcludedApps: [],
      initialExcludedUrlPatterns: ['*://mail.google.com/*'],
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
        title: 'Gmail',
        url: 'https://mail.google.com/mail/u/0/#inbox',
      }),
    )

    expect(flushCount).toBe(1)
    expect(suppressionTransitions).toEqual([true])
    expect(forwarded).toHaveLength(0)
  })

  it('matches a domain but not the same name mentioned in another site query', () => {
    const suppressionTransitions: boolean[] = []
    const coordinator = createCaptureBlacklistCoordinator({
      initialExcludedApps: [],
      initialExcludedUrlPatterns: ['https://linear.app'],
      initialExcludePrivateBrowsing: false,
      forwardInteraction: () => undefined,
      flushEvents: () => undefined,
      setScreenshotsSuppressed: (suppressed) => {
        suppressionTransitions.push(suppressed)
      },
    })

    coordinator.handleInteraction(
      appChangeEvent('Google Chrome', {
        title: 'Search',
        url: 'https://google.com/?q=linear.app',
      }),
    )
    expect(suppressionTransitions).toEqual([])

    coordinator.handleInteraction(
      appChangeEvent('Google Chrome', { title: 'Linear', url: 'https://linear.app/issue/123' }),
    )
    expect(suppressionTransitions).toEqual([true])
  })

  it('enforces a managed domain entry against a real URL', () => {
    const suppressionTransitions: boolean[] = []
    const coordinator = createCaptureBlacklistCoordinator({
      initialExcludedApps: [],
      initialExcludePrivateBrowsing: false,
      forwardInteraction: () => undefined,
      flushEvents: () => undefined,
      setScreenshotsSuppressed: (suppressed) => {
        suppressionTransitions.push(suppressed)
      },
    })

    // An org pushes a domain; it must match the host of a real https:// URL.
    coordinator.setManagedExclusions({ apps: [], urlPatterns: ['bank.com'] })

    coordinator.handleInteraction(
      appChangeEvent('Google Chrome', { title: 'Bank', url: 'https://bank.com/accounts' }),
    )
    expect(suppressionTransitions).toEqual([true])
  })

  it('enforces a user domain entry against a real URL', () => {
    const suppressionTransitions: boolean[] = []
    const coordinator = createCaptureBlacklistCoordinator({
      initialExcludedApps: [],
      initialExcludedUrlPatterns: ['bank.com'],
      initialExcludePrivateBrowsing: false,
      forwardInteraction: () => undefined,
      flushEvents: () => undefined,
      setScreenshotsSuppressed: (suppressed) => {
        suppressionTransitions.push(suppressed)
      },
    })

    coordinator.handleInteraction(
      appChangeEvent('Google Chrome', { title: 'Bank', url: 'https://bank.com/accounts' }),
    )
    expect(suppressionTransitions).toEqual([true])
  })
})
