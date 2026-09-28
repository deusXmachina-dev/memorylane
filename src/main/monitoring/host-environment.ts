import { describeNetworkError } from '@main/utils/network-error'
import { isLoopbackUrl } from '@/shared/url-utils'

export type StandDownReason = 'suspended' | 'offline'

export const AWAKE_CHECK_DELAYS_MS = [30_000, 60_000, 90_000]

export abstract class HostEnvironment {
  abstract isSuspended(): boolean
  abstract isOnline(): boolean
  abstract lastSuspendAt(): number
  abstract resolves(host: string): Promise<boolean>
  abstract onSuspend(listener: () => void): () => void
  abstract onResume(listener: () => void): () => void

  standDownReason(targetUrl: string | undefined): StandDownReason | null {
    if (this.isSuspended()) return 'suspended'
    if (this.isOnline()) return null
    if (targetUrl && isLoopbackUrl(targetUrl)) return null
    return 'offline'
  }

  interruptedBy(startedAt: number, targetUrl: string | undefined, error: unknown): boolean {
    if (describeNetworkError(error) === null) return false
    return this.lastSuspendAt() > startedAt || this.standDownReason(targetUrl) !== null
  }

  suspendSignal(): { signal: AbortSignal; release: () => void } {
    const controller = new AbortController()
    const release = this.onSuspend(() =>
      controller.abort(new DOMException('System suspended', 'AbortError')),
    )
    return { signal: controller.signal, release }
  }

  onAwake(listener: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined
    const clear = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }
    const check = (attempt: number): void => {
      timer = undefined
      if (this.isSuspended()) return
      if (this.isOnline() || attempt >= AWAKE_CHECK_DELAYS_MS.length) {
        listener()
        return
      }
      timer = setTimeout(() => check(attempt + 1), AWAKE_CHECK_DELAYS_MS[attempt])
    }
    const unsubscribe = this.onResume(() => {
      clear()
      timer = setTimeout(() => check(1), AWAKE_CHECK_DELAYS_MS[0])
    })
    return () => {
      unsubscribe()
      clear()
    }
  }
}

export class ManualHostEnvironment extends HostEnvironment {
  suspended = false
  online = true
  suspendedAt = 0
  resolvable = true
  readonly suspendListeners = new Set<() => void>()
  readonly resumeListeners = new Set<() => void>()

  isSuspended(): boolean {
    return this.suspended
  }

  isOnline(): boolean {
    return this.online
  }

  lastSuspendAt(): number {
    return this.suspendedAt
  }

  async resolves(): Promise<boolean> {
    return this.resolvable
  }

  onSuspend(listener: () => void): () => void {
    this.suspendListeners.add(listener)
    return () => {
      this.suspendListeners.delete(listener)
    }
  }

  onResume(listener: () => void): () => void {
    this.resumeListeners.add(listener)
    return () => {
      this.resumeListeners.delete(listener)
    }
  }

  suspend(at: number = Date.now()): void {
    this.suspended = true
    this.suspendedAt = at
    for (const listener of this.suspendListeners) listener()
  }

  resume(): void {
    this.suspended = false
    for (const listener of this.resumeListeners) listener()
  }
}
