import type { RemoteModelConfig } from '../../shared/remote-model-config'
import { RemoteSyncService, type RemoteSyncServiceParams } from './remote-sync-service'
import { coerceRemoteModelConfig } from './remote-model-config-store'

// Poll cadence for the model pipeline config. The point of remote config is
// that a degraded/repriced model can be swapped out within minutes, not on the
// next app update — 5 minutes bounds that lag while a no-change sync stays a
// cheap GET of a tiny static payload.
const DEFAULT_SYNC_INTERVAL_MS = 5 * 60 * 1000

/**
 * Polls the backend's model pipeline config (`GET api/config/models`). The
 * latest fetched config is pushed into the live services as-is. `isActivated`
 * gates syncing entirely: it requires a managed key for the active vendor
 * (plus enterprise activation in that edition) — BYOK/custom installs never
 * poll.
 */
export class RemoteModelConfigService extends RemoteSyncService<RemoteModelConfig> {
  constructor(params: RemoteSyncServiceParams<RemoteModelConfig>) {
    super('RemoteModelConfig', params, DEFAULT_SYNC_INTERVAL_MS)
  }

  getConfig(): RemoteModelConfig | null {
    return this.getValue()
  }

  protected describe(config: RemoteModelConfig): string {
    return `config v${config.version} (${Object.keys(config.models).length} slots)`
  }

  protected async fetchRemote(base: string): Promise<RemoteModelConfig> {
    const config = coerceRemoteModelConfig(
      await this.fetchJson(this.endpoint(base, 'api/config/models')),
    )
    if (config === null) {
      throw new Error('Remote model config response is malformed')
    }
    return config
  }
}
