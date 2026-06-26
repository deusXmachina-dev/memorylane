import type { CaptureSettings } from '../../shared/types'
import { Blacklist } from './blacklist'

/** The slice of {@link CaptureSettingsManager} that {@link LocalBlacklist} needs. */
export interface CaptureSettingsStore {
  get(): Pick<CaptureSettings, 'excludedApps' | 'excludedUrlPatterns' | 'excludePrivateBrowsing'>
  save(partial: Partial<CaptureSettings>): void
}

/**
 * The device user's own capture exclusions — a thin adapter over the capture
 * settings store (the record of truth). The data stays in capture-settings.json
 * and the store keeps normalization + the URL schema migration; this class just
 * exposes it as a {@link Blacklist} and notifies on change. Unlike the remote
 * source, these are user-editable.
 */
export class LocalBlacklist extends Blacklist {
  constructor(private readonly settings: CaptureSettingsStore) {
    super()
  }

  getBlacklistedApps(): string[] {
    return this.settings.get().excludedApps
  }

  getBlacklistedUrls(): string[] {
    return this.settings.get().excludedUrlPatterns
  }

  /** Private browsing is a local-only matching policy, not an app/URL, so it
   * sits outside the {@link Blacklist} contract. */
  getExcludePrivateBrowsing(): boolean {
    return this.settings.get().excludePrivateBrowsing
  }

  /** Persists the exclusion fields through the settings store, then notifies. */
  update(rules: { apps: string[]; urlPatterns: string[]; excludePrivateBrowsing: boolean }): void {
    this.settings.save({
      excludedApps: rules.apps,
      excludedUrlPatterns: rules.urlPatterns,
      excludePrivateBrowsing: rules.excludePrivateBrowsing,
    })
    this.emit()
  }

  /** Re-reads and notifies WITHOUT writing — for callers (the saveCaptureSettings
   * IPC handler) that already persisted the full settings object and only need
   * the coordinator to pick up the change. Avoids a redundant second write. */
  notifyChanged(): void {
    this.emit()
  }
}
