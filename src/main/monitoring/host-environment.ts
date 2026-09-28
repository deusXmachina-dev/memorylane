import { describeNetworkError } from '@main/utils/network-error'
import { isLoopbackUrl } from '@/shared/url-utils'

export interface HostEnvironment {
  isSuspended(): boolean
  isOnline(): boolean
  lastSuspendAt(): number
  resolves(host: string): Promise<boolean>
  onSuspend(listener: () => void): () => void
}

export const DEFAULT_HOST_ENVIRONMENT: HostEnvironment = {
  isSuspended: () => false,
  isOnline: () => true,
  lastSuspendAt: () => 0,
  resolves: async () => true,
  onSuspend: () => () => {},
}

export type StandDownReason = 'suspended' | 'offline'

export function standDownReason(
  env: HostEnvironment,
  targetUrl: string | undefined,
): StandDownReason | null {
  if (env.isSuspended()) return 'suspended'
  if (env.isOnline()) return null
  if (targetUrl && isLoopbackUrl(targetUrl)) return null
  return 'offline'
}

export function interruptedByHost(
  env: HostEnvironment,
  startedAt: number,
  targetUrl: string | undefined,
  error: unknown,
): boolean {
  if (describeNetworkError(error) === null) return false
  return env.lastSuspendAt() > startedAt || standDownReason(env, targetUrl) !== null
}

export function suspendSignal(env: HostEnvironment): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController()
  const release = env.onSuspend(() =>
    controller.abort(new DOMException('System suspended', 'AbortError')),
  )
  return { signal: controller.signal, release }
}
