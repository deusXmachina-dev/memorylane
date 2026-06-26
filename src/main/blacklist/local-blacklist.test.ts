import { describe, expect, it, vi } from 'vitest'
import type { CaptureSettings } from '../../shared/types'
import { LocalBlacklist, type CaptureSettingsStore } from './local-blacklist'

function createFakeStore(seed?: {
  excludedApps?: string[]
  excludedUrlPatterns?: string[]
  excludePrivateBrowsing?: boolean
}) {
  const state = {
    excludedApps: seed?.excludedApps ?? [],
    excludedUrlPatterns: seed?.excludedUrlPatterns ?? [],
    excludePrivateBrowsing: seed?.excludePrivateBrowsing ?? true,
  }
  const save = vi.fn((partial: Partial<CaptureSettings>) => {
    if (partial.excludedApps !== undefined) state.excludedApps = partial.excludedApps
    if (partial.excludedUrlPatterns !== undefined)
      state.excludedUrlPatterns = partial.excludedUrlPatterns
    if (partial.excludePrivateBrowsing !== undefined)
      state.excludePrivateBrowsing = partial.excludePrivateBrowsing
  })
  const store: CaptureSettingsStore = { get: () => ({ ...state }), save }
  return { store, save }
}

describe('LocalBlacklist', () => {
  it('exposes the stored exclusions and private-browsing flag', () => {
    const { store } = createFakeStore({
      excludedApps: ['signal'],
      excludedUrlPatterns: ['*bank*'],
      excludePrivateBrowsing: false,
    })
    const local = new LocalBlacklist(store)

    expect(local.getBlacklistedApps()).toEqual(['signal'])
    expect(local.getBlacklistedUrls()).toEqual(['*bank*'])
    expect(local.getExcludePrivateBrowsing()).toBe(false)
    expect(local.getSnapshot()).toEqual({ apps: ['signal'], urlPatterns: ['*bank*'] })
  })

  it('persists the exclusion fields through the store and notifies on update', () => {
    const { store, save } = createFakeStore()
    const local = new LocalBlacklist(store)
    const listener = vi.fn()
    local.onChange(listener)

    local.update({ apps: ['signal'], urlPatterns: ['*bank*'], excludePrivateBrowsing: false })

    expect(save).toHaveBeenCalledWith({
      excludedApps: ['signal'],
      excludedUrlPatterns: ['*bank*'],
      excludePrivateBrowsing: false,
    })
    expect(listener).toHaveBeenCalledWith({ apps: ['signal'], urlPatterns: ['*bank*'] })
    expect(local.getBlacklistedApps()).toEqual(['signal'])
  })

  it('notifyChanged emits the current snapshot without writing', () => {
    const { store, save } = createFakeStore({ excludedApps: ['signal'] })
    const local = new LocalBlacklist(store)
    const listener = vi.fn()
    local.onChange(listener)

    local.notifyChanged()

    expect(save).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledWith({ apps: ['signal'], urlPatterns: [] })
  })

  it('stops notifying after unsubscribe and after dispose', () => {
    const { store } = createFakeStore()
    const local = new LocalBlacklist(store)

    const unsubscribed = vi.fn()
    const off = local.onChange(unsubscribed)
    off()

    const disposed = vi.fn()
    local.onChange(disposed)
    local.dispose()

    local.notifyChanged()
    expect(unsubscribed).not.toHaveBeenCalled()
    expect(disposed).not.toHaveBeenCalled()
  })
})
