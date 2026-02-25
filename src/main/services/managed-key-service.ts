import { shell } from 'electron'
import log from '../logger'
import { MANAGED_KEY_CONFIG } from '../../shared/constants'
import type { DeviceIdentity } from '../settings/device-identity'
import type { SubscriptionPlan, SubscriptionStatus } from '../../shared/types'

interface ManagedKeyPayload {
  error?: string
  key?: string
  invalidate?: boolean
}

export type ManagedKeyCallback = (status: SubscriptionStatus, payload?: ManagedKeyPayload) => void

export class ManagedKeyService {
  private readonly deviceIdentity: DeviceIdentity
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null
  private status: SubscriptionStatus = 'idle'
  private onUpdate: ManagedKeyCallback | null = null

  constructor(deviceIdentity: DeviceIdentity) {
    this.deviceIdentity = deviceIdentity
  }

  public setUpdateCallback(callback: ManagedKeyCallback): void {
    this.onUpdate = callback
  }

  public getStatus(): SubscriptionStatus {
    return this.status
  }

  /**
   * Try fetching a provisioned key once (e.g. on app startup).
   * If the backend returns an OK response with no key, signals invalidation
   * so the caller can remove a stale locally-stored managed key.
   */
  public async tryFetchKey(): Promise<void> {
    try {
      const key = await this.fetchKey(this.deviceIdentity.getDeviceId())
      if (key) {
        log.info('[ManagedKeyService] Received provisioned key')
        this.setStatus('idle', { key })
      } else {
        log.info('[ManagedKeyService] No key from backend, invalidating local managed key')
        this.setStatus('idle', { invalidate: true })
      }
    } catch (error) {
      log.warn('[ManagedKeyService] Initial fetch failed:', error)
    }
  }

  /**
   * Open checkout in the system browser and start polling for the provisioned key.
   */
  public async startCheckout(plan: SubscriptionPlan = 'standard'): Promise<void> {
    if (this.status === 'polling' || this.status === 'awaiting_checkout') {
      log.warn('[ManagedKeyService] Checkout already in progress')
      return
    }

    const deviceId = this.deviceIdentity.getDeviceId()

    const url = new URL('/subscription/checkout', MANAGED_KEY_CONFIG.BACKEND_URL)
    url.searchParams.set('device_id', deviceId)
    url.searchParams.set('plan', plan)

    this.setStatus('awaiting_checkout')

    await shell.openExternal(url.toString())

    log.info('[ManagedKeyService] Opened checkout in system browser, starting key polling')

    this.startPolling(deviceId)
  }

  /**
   * Open the subscription management portal in the system browser.
   */
  public async openSubscriptionPortal(): Promise<void> {
    const deviceId = this.deviceIdentity.getDeviceId()

    const url = new URL('/subscription/portal', MANAGED_KEY_CONFIG.BACKEND_URL)
    url.searchParams.set('device_id', deviceId)

    await shell.openExternal(url.toString())

    log.info('[ManagedKeyService] Opened subscription portal in system browser')
  }

  public cancelPolling(): void {
    this.clearTimers()
    this.setStatus('idle')
    log.info('[ManagedKeyService] Polling cancelled')
  }

  private startPolling(deviceId: string): void {
    this.setStatus('polling')

    this.pollTimer = setInterval(() => {
      void this.pollForKey(deviceId)
    }, MANAGED_KEY_CONFIG.POLL_INTERVAL_MS)

    this.timeoutTimer = setTimeout(() => {
      log.warn('[ManagedKeyService] Polling timed out')
      this.clearTimers()
      this.setStatus('error', { error: 'Checkout timed out. Please try again.' })
    }, MANAGED_KEY_CONFIG.POLL_TIMEOUT_MS)
  }

  private async pollForKey(deviceId: string): Promise<void> {
    try {
      const key = await this.fetchKey(deviceId)
      if (key) {
        log.info('[ManagedKeyService] Received provisioned key')
        this.clearTimers()
        this.setStatus('idle', { key })
      }
    } catch (error) {
      log.warn('[ManagedKeyService] Poll request failed:', error)
    }
  }

  /**
   * Fetch the provisioned key from the backend.
   * Returns the API key string, or null if no key is provisioned.
   * Throws on network errors or non-OK responses that aren't server errors.
   */
  private async fetchKey(deviceId: string): Promise<string | null> {
    const url = new URL('/subscription/key', MANAGED_KEY_CONFIG.BACKEND_URL)
    url.searchParams.set('device_id', deviceId)

    const response = await fetch(url.toString())

    if (!response.ok) {
      if (response.status >= 500) {
        log.warn(`[ManagedKeyService] Server error: ${response.status}`)
      }
      return null
    }

    const data = (await response.json()) as { key?: string | null }
    return data.key ?? null
  }

  private setStatus(status: SubscriptionStatus, payload?: ManagedKeyPayload): void {
    this.status = status
    this.onUpdate?.(status, payload)
  }

  private clearTimers(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer)
      this.timeoutTimer = null
    }
  }
}
