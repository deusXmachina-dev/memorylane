import type { ManagedExclusions } from '../../shared/types'

/**
 * A source's exclusions, kept raw (un-normalized) so the UI can resolve managed
 * bundle ids to friendly names. The {@link BlacklistCoordinator} normalizes for
 * matching.
 */
export type BlacklistSnapshot = ManagedExclusions

/**
 * A source of capture exclusions (apps + URL patterns). Concrete sources —
 * {@link LocalBlacklist} (the device user's own settings) and
 * {@link RemoteBlacklist} (the org's centrally-synced policy, enterprise only) —
 * extend this; the {@link BlacklistCoordinator} unions them and applies the
 * result. The base owns the subscriber plumbing; subclasses implement the
 * getters and call {@link emit} when their values change.
 */
export abstract class Blacklist {
  private readonly listeners = new Set<(snapshot: BlacklistSnapshot) => void>()

  abstract getBlacklistedApps(): string[]
  abstract getBlacklistedUrls(): string[]

  getSnapshot(): BlacklistSnapshot {
    return { apps: this.getBlacklistedApps(), urlPatterns: this.getBlacklistedUrls() }
  }

  /** Subscribe to changes. Returns an unsubscribe function. */
  onChange(listener: (snapshot: BlacklistSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    this.listeners.clear()
  }

  protected emit(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}
