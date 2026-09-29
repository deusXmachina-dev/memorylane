import { net, powerMonitor } from 'electron'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import log from '@main/utils/logger'
import { describeNetworkError } from '@main/utils/network-error'
import { isLoopbackUrl } from '@/shared/url-utils'
import { HOST_RESOLVE_TIMEOUT_MS } from '@/shared/constants'

export type StandDownReason = 'suspended' | 'offline' | 'unresolved'

export const AWAKE_CHECK_DELAYS_MS = [30_000, 60_000, 90_000]

export function remoteHost(url: string | undefined): string | null {
  if (!url || isLoopbackUrl(url)) return null
  try {
    const host = new URL(url).hostname.replace(/^\[(.*)\]$/, '$1')
    return isIP(host) ? null : host
  } catch {
    return null
  }
}

export class HostEnvironment {
  private screenLocked = false
  private suspended = false
  private onBattery = false
  private suspendedAt = 0
  private onPauseChange: ((pause: boolean) => void) | null = null
  protected readonly suspendListeners = new Set<() => void>()
  protected readonly resumeListeners = new Set<() => void>()

  start(onPauseChange: (pause: boolean) => void): void {
    this.onPauseChange = onPauseChange
    this.onBattery = powerMonitor.isOnBatteryPower()

    powerMonitor.on('lock-screen', () => {
      log.info('[Power] Screen locked')
      this.screenLocked = true
      this.emitPauseState()
    })
    powerMonitor.on('unlock-screen', () => {
      log.info('[Power] Screen unlocked')
      this.screenLocked = false
      this.emitPauseState()
    })
    powerMonitor.on('suspend', () => {
      log.info('[Power] System suspended')
      this.handleSuspend(Date.now())
    })
    powerMonitor.on('resume', () => {
      log.info('[Power] System resumed')
      this.handleResume()
    })
    powerMonitor.on('on-ac', () => {
      log.info('[Power] Switched to AC power')
      this.onBattery = false
    })
    powerMonitor.on('on-battery', () => {
      log.info('[Power] Switched to battery power')
      this.onBattery = true
    })

    log.info(`[Power] Monitoring started (onBattery=${this.onBattery})`)
  }

  shouldPause(): boolean {
    return this.screenLocked || this.suspended
  }

  /** Still true through a macOS dark wake, which runs timers without emitting 'resume'. */
  isSuspended(): boolean {
    return this.suspended
  }

  /** Epoch ms of the last system suspend, 0 if none since launch. */
  lastSuspendAt(): number {
    return this.suspendedAt
  }

  isOnline(): boolean {
    return net.isOnline()
  }

  /** Seconds since the last system-wide user input (mouse move counts), per the OS. */
  idleSeconds(): number {
    return powerMonitor.getSystemIdleTime()
  }

  resolves(host: string): Promise<boolean> {
    return lookup(host).then(
      () => true,
      () => false,
    )
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

  standDownReason(targetUrl: string | undefined): StandDownReason | null {
    if (this.isSuspended()) return 'suspended'
    if (this.isOnline()) return null
    if (targetUrl && isLoopbackUrl(targetUrl)) return null
    return 'offline'
  }

  async standDown(targetUrl: string | undefined): Promise<StandDownReason | null> {
    const reason = this.standDownReason(targetUrl)
    if (reason !== null) return reason
    const host = remoteHost(targetUrl)
    if (host === null) return null
    return (await this.resolvesWithinTimeout(host)) ? null : 'unresolved'
  }

  resolvesWithinTimeout(host: string): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), HOST_RESOLVE_TIMEOUT_MS)
    })
    return Promise.race([this.resolves(host), timeout]).finally(() => clearTimeout(timer))
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

  protected handleSuspend(at: number): void {
    this.suspended = true
    this.suspendedAt = at
    for (const listener of this.suspendListeners) listener()
    this.emitPauseState()
  }

  protected handleResume(): void {
    this.suspended = false
    for (const listener of this.resumeListeners) listener()
    this.emitPauseState()
  }

  private emitPauseState(): void {
    if (!this.onPauseChange) return
    const pause = this.shouldPause()
    log.info(
      `[Power] State: screenLocked=${this.screenLocked}, suspended=${this.suspended}, onBattery=${this.onBattery} → ${pause ? 'pause' : 'resume'}`,
    )
    this.onPauseChange(pause)
  }
}

export class ManualHostEnvironment extends HostEnvironment {
  online = true
  resolvable = true

  override isOnline(): boolean {
    return this.online
  }

  override async resolves(): Promise<boolean> {
    return this.resolvable
  }

  suspend(at: number = Date.now()): void {
    this.handleSuspend(at)
  }

  resume(): void {
    this.handleResume()
  }

  get suspendListenerCount(): number {
    return this.suspendListeners.size
  }

  get resumeListenerCount(): number {
    return this.resumeListeners.size
  }
}
