import { backendPlatformToken } from '@main/utils/platform'
import type { ManagedExclusions } from '../../shared/types'
import { ENTERPRISE_BACKEND_CONFIG } from '../../shared/constants'
import { RemoteSyncService, type RemoteSyncServiceParams } from './remote-sync-service'
import { coerceManagedExclusions } from './remote-blacklist-store'

const EMPTY: ManagedExclusions = { apps: [], urlPatterns: [] }

// Poll cadence for the tenant blacklist. Cheap, since a sync only notifies on a
// real change. Shares the enterprise status-refresh interval (5 min) — IT edits
// the policy rarely, so there's no need to poll more often.
const DEFAULT_SYNC_INTERVAL_MS = ENTERPRISE_BACKEND_CONFIG.STATUS_REFRESH_INTERVAL_MS

/**
 * Polls the tenant's centralized blacklist. The coordinator unions it with the
 * user's exclusions, so managed entries are always enforced and not removable.
 * A backend blip never drops the blacklist — only a clean 200 with an empty
 * list clears it.
 */
export class RemoteBlacklistService extends RemoteSyncService<ManagedExclusions> {
  constructor(params: RemoteSyncServiceParams<ManagedExclusions>) {
    super('RemoteBlacklist', params, DEFAULT_SYNC_INTERVAL_MS)
  }

  getBlacklist(): ManagedExclusions {
    return this.getValue() ?? EMPTY
  }

  protected describe(blacklist: ManagedExclusions): string {
    return `blacklist: ${blacklist.apps.length} apps, ${blacklist.urlPatterns.length} url patterns`
  }

  protected serialize(blacklist: ManagedExclusions): string {
    return JSON.stringify([blacklist.apps, blacklist.urlPatterns])
  }

  protected async fetchRemote(base: string): Promise<ManagedExclusions> {
    const url = this.endpoint(base, 'api/license/blacklist')
    // Narrow app tokens to this platform's identifiers (macOS bundle ids vs.
    // Windows process names); the device can't match the other's.
    const platform = backendPlatformToken()
    if (platform) url.searchParams.set('platform', platform)
    const data = (await this.fetchJson(url)) as {
      excludedApps?: unknown
      excludedUrlPatterns?: unknown
    }
    return coerceManagedExclusions(data.excludedApps, data.excludedUrlPatterns)
  }
}
