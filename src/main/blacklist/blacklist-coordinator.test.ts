import { describe, expect, it } from 'vitest'
import type { CaptureSettings, InteractionContext } from '../../shared/types'
import { Blacklist } from './blacklist'
import { LocalBlacklist, type CaptureSettingsStore } from './local-blacklist'
import { BlacklistCoordinator } from './blacklist-coordinator'

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

type LocalSeed = {
  excludedApps?: string[]
  excludedUrlPatterns?: string[]
  excludePrivateBrowsing?: boolean
}

/** In-memory stand-in for CaptureSettingsManager — only the exclusion slice. */
function createFakeStore(seed: LocalSeed): CaptureSettingsStore {
  const state = {
    excludedApps: seed.excludedApps ?? [],
    excludedUrlPatterns: seed.excludedUrlPatterns ?? [],
    excludePrivateBrowsing: seed.excludePrivateBrowsing ?? true,
  }
  return {
    get: () => ({ ...state }),
    save: (partial: Partial<CaptureSettings>) => {
      if (partial.excludedApps !== undefined) state.excludedApps = partial.excludedApps
      if (partial.excludedUrlPatterns !== undefined)
        state.excludedUrlPatterns = partial.excludedUrlPatterns
      if (partial.excludePrivateBrowsing !== undefined)
        state.excludePrivateBrowsing = partial.excludePrivateBrowsing
    },
  }
}

/** A controllable managed source, standing in for the enterprise RemoteBlacklist. */
class FakeRemoteBlacklist extends Blacklist {
  private apps: string[] = []
  private urls: string[] = []
  getBlacklistedApps(): string[] {
    return this.apps
  }
  getBlacklistedUrls(): string[] {
    return this.urls
  }
  set(next: { apps: string[]; urlPatterns: string[] }): void {
    this.apps = next.apps
    this.urls = next.urlPatterns
    this.emit()
  }
}

function makeCoordinator(opts: {
  local?: LocalSeed
  remote?: FakeRemoteBlacklist
  onPrivacyBlockingChanged?: (blocked: boolean) => void
}) {
  const forwarded: InteractionContext[] = []
  const suppressionTransitions: boolean[] = []
  const flushes: true[] = []
  const local = new LocalBlacklist(createFakeStore(opts.local ?? {}))
  const coordinator = new BlacklistCoordinator(local, opts.remote ?? null, {
    onPrivacyBlockingChanged: opts.onPrivacyBlockingChanged,
    forwardInteraction: (event) => forwarded.push(event),
    flushEvents: () => flushes.push(true),
    setScreenshotsSuppressed: (suppressed) => suppressionTransitions.push(suppressed),
  })
  return { coordinator, local, forwarded, suppressionTransitions, flushes }
}

describe('blacklist coordinator', () => {
  it('suppresses screenshots and drops events while excluded app is active', () => {
    const { coordinator, forwarded, suppressionTransitions, flushes } = makeCoordinator({
      local: { excludedApps: ['signal'] },
    })

    coordinator.handleInteraction(appChangeEvent('Signal'))
    coordinator.handleInteraction({ type: 'keyboard', timestamp: Date.now(), keyCount: 3 })

    expect(flushes).toHaveLength(1)
    expect(suppressionTransitions).toEqual([true])
    expect(forwarded).toHaveLength(0)
  })

  it('emits privacy blocking transitions when entering and leaving blocked state', () => {
    const privacyTransitions: boolean[] = []
    const { coordinator } = makeCoordinator({
      local: { excludedApps: ['signal'] },
      onPrivacyBlockingChanged: (blocked) => privacyTransitions.push(blocked),
    })

    coordinator.handleInteraction(appChangeEvent('Signal'))
    coordinator.handleInteraction(appChangeEvent('Terminal'))

    expect(privacyTransitions).toEqual([true, false])
  })

  it('resumes screenshots and forwards events when allowed app becomes active', () => {
    const { coordinator, forwarded, suppressionTransitions } = makeCoordinator({
      local: { excludedApps: ['signal'] },
    })

    coordinator.handleInteraction(appChangeEvent('Signal'))
    const terminalEvent = appChangeEvent('Terminal')
    coordinator.handleInteraction(terminalEvent)

    expect(suppressionTransitions).toEqual([true, false])
    expect(forwarded).toEqual([terminalEvent])
  })

  it('reacts immediately when excluded app settings change', () => {
    const { coordinator, local, suppressionTransitions, flushes } = makeCoordinator({
      local: { excludedApps: [] },
    })

    coordinator.handleInteraction(appChangeEvent('KeePassXC'))
    local.update({
      apps: ['keepassxc'],
      urlPatterns: [],
      excludePrivateBrowsing: true,
    })

    expect(flushes).toHaveLength(1)
    expect(suppressionTransitions).toEqual([true])
  })

  it('suppresses screenshots for browser anonymous mode windows', () => {
    const { coordinator, forwarded, suppressionTransitions, flushes } = makeCoordinator({
      local: { excludedApps: [] },
    })

    coordinator.handleInteraction(
      appChangeEvent('Google Chrome', {
        title: 'New Incognito Tab - Google Chrome',
      }),
    )
    coordinator.handleInteraction({ type: 'keyboard', timestamp: Date.now(), keyCount: 2 })

    expect(flushes).toHaveLength(1)
    expect(suppressionTransitions).toEqual([true])
    expect(forwarded).toHaveLength(0)
  })

  it('resumes once browser leaves anonymous mode', () => {
    const { coordinator, forwarded, suppressionTransitions } = makeCoordinator({
      local: { excludedApps: [] },
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
    const { coordinator, forwarded, suppressionTransitions, flushes } = makeCoordinator({
      local: { excludedApps: [] },
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

    expect(flushes).toHaveLength(1)
    expect(suppressionTransitions).toEqual([true, false])
    expect(forwarded).toEqual([normalChromeWindow])
  })

  it('does not suppress anonymous browser windows when private browsing exclusion is disabled', () => {
    const { coordinator, forwarded, suppressionTransitions } = makeCoordinator({
      local: { excludedApps: [], excludePrivateBrowsing: false },
    })

    const incognitoEdgeWindow = appChangeEvent('Microsoft Edge', {
      title: 'InPrivate - Microsoft Edge',
    })
    coordinator.handleInteraction(incognitoEdgeWindow)

    expect(suppressionTransitions).toEqual([])
    expect(forwarded).toEqual([incognitoEdgeWindow])
  })

  it('clears sticky anonymous hwnd suppression when private browsing exclusion is disabled', () => {
    const { coordinator, local, forwarded, suppressionTransitions } = makeCoordinator({
      local: { excludedApps: [] },
    })

    coordinator.handleInteraction(
      appChangeEvent('chrome', {
        hwnd: '0x6B0A0A',
        title: 'New Incognito tab - Google Chrome',
      }),
    )

    local.update({
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
    const { coordinator, forwarded, suppressionTransitions } = makeCoordinator({
      local: { excludedApps: [] },
    })

    const terminalEvent = appChangeEvent('Terminal', {
      title: 'private browsing notes.md',
    })
    coordinator.handleInteraction(terminalEvent)

    expect(suppressionTransitions).toEqual([])
    expect(forwarded).toEqual([terminalEvent])
  })

  it('enforces org-managed app exclusions immediately when synced', () => {
    const remote = new FakeRemoteBlacklist()
    const { coordinator, suppressionTransitions } = makeCoordinator({
      local: { excludedApps: [] },
      remote,
    })

    coordinator.handleInteraction(appChangeEvent('Slack'))
    remote.set({ apps: ['Slack'], urlPatterns: [] })

    expect(suppressionTransitions).toEqual([true])
  })

  it('keeps managed exclusions enforced across a user settings change (union of both layers)', () => {
    const remote = new FakeRemoteBlacklist()
    const { coordinator, local, forwarded, suppressionTransitions } = makeCoordinator({
      local: { excludedApps: ['signal'] },
      remote,
    })

    remote.set({ apps: ['slack'], urlPatterns: [] })

    // A later user settings save (no Slack) must not drop the managed entry.
    local.update({
      apps: ['signal'],
      urlPatterns: [],
      excludePrivateBrowsing: true,
    })

    coordinator.handleInteraction(appChangeEvent('Slack'))
    expect(suppressionTransitions).toEqual([true])
    expect(forwarded).toHaveLength(0)
  })

  it('suppresses screenshots when url matches excluded wildcard', () => {
    const { coordinator, forwarded, suppressionTransitions, flushes } = makeCoordinator({
      local: { excludedApps: [], excludedUrlPatterns: ['*://mail.google.com/*'] },
    })

    coordinator.handleInteraction(
      appChangeEvent('Google Chrome', {
        title: 'Gmail',
        url: 'https://mail.google.com/mail/u/0/#inbox',
      }),
    )

    expect(flushes).toHaveLength(1)
    expect(suppressionTransitions).toEqual([true])
    expect(forwarded).toHaveLength(0)
  })

  it('matches a url prefix but not the same domain in another query', () => {
    const { coordinator, suppressionTransitions } = makeCoordinator({
      local: {
        excludedApps: [],
        excludedUrlPatterns: ['https://linear.app'],
        excludePrivateBrowsing: false,
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

  it('enforces a bare-host managed url pattern by normalizing it to a scheme prefix', () => {
    const remote = new FakeRemoteBlacklist()
    const { coordinator, suppressionTransitions } = makeCoordinator({
      local: { excludedApps: [], excludePrivateBrowsing: false },
      remote,
    })

    // An org pushes a bare host (no scheme). Without normalization the
    // starts-with matcher would never match a real https:// URL.
    remote.set({ apps: [], urlPatterns: ['bank.com'] })

    coordinator.handleInteraction(
      appChangeEvent('Google Chrome', { title: 'Bank', url: 'https://bank.com/accounts' }),
    )
    expect(suppressionTransitions).toEqual([true])
  })

  it('enforces a bare-host user url pattern by normalizing it to a scheme prefix', () => {
    const { coordinator, suppressionTransitions } = makeCoordinator({
      local: {
        excludedApps: [],
        excludedUrlPatterns: ['bank.com'],
        excludePrivateBrowsing: false,
      },
    })

    coordinator.handleInteraction(
      appChangeEvent('Google Chrome', { title: 'Bank', url: 'https://bank.com/accounts' }),
    )
    expect(suppressionTransitions).toEqual([true])
  })
})
