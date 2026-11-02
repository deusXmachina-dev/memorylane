import type { HostEnvironment } from '@main/monitoring/host-environment'

export interface BackendClientParams {
  getDeviceId: () => string
  getBackendUrl: () => string
  env: HostEnvironment
}

export interface BackendRequest {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: BodyInit
  timeoutMs: number
}

/** Device-authenticated requests to the backend that stand down around sleep and network loss. */
export class BackendClient {
  constructor(private readonly params: BackendClientParams) {}

  /** Why a scheduled request shouldn't go out now, or null. */
  async standDown(): Promise<string | null> {
    const base = this.params.getBackendUrl()
    if (!base) return 'no backend URL'
    return this.params.env.standDown(base)
  }

  async request(path: string, init: BackendRequest): Promise<Response> {
    const base = this.params.getBackendUrl().replace(/\/?$/, '/')
    const suspend = this.params.env.suspendSignal()
    try {
      return await fetch(new URL(path, base), {
        method: init.method ?? 'GET',
        headers: { Authorization: `Bearer ${this.params.getDeviceId()}` },
        body: init.body,
        signal: AbortSignal.any([AbortSignal.timeout(init.timeoutMs), suspend.signal]),
      })
    } finally {
      suspend.release()
    }
  }

  /** True when a request that started at `startedAt` failed because of sleep or a network drop. */
  interrupted(startedAt: number, error: unknown): boolean {
    return this.params.env.interruptedBy(startedAt, this.params.getBackendUrl(), error)
  }
}
