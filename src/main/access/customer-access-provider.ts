import { shell } from 'electron'
import { MANAGED_KEY_CONFIG } from '../../shared/constants'
import type { SubscriptionPlan } from '../../shared/types'
import log from '../logger'
import type { DeviceIdentity } from '../settings/device-identity'
import { BaseAccessProvider } from './base-access-provider'
import {
  setCustomerPolling,
  transitionCustomerAccess,
  type CustomerAccessTransition,
} from './customer-access-machine'
import { createInitialAccessState } from './types'

export class CustomerAccessProvider extends BaseAccessProvider {
  private readonly deviceIdentity: DeviceIdentity
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null
  private refreshTimer: ReturnType<typeof setInterval> | null = null

  constructor(deviceIdentity: DeviceIdentity) {
    super(createInitialAccessState('customer'))
    this.deviceIdentity = deviceIdentity
  }

  public async refreshAccessState(): Promise<void> {
    try {
      const key = await this.fetchCustomerKey(this.deviceIdentity.getDeviceId())
      if (key) {
        log.info('[CustomerAccess] Received managed customer key')
        this.applyTransition(
          transitionCustomerAccess(this.accessState, {
            type: 'key_received',
            key,
          }),
        )
        return
      }

      log.info(
        '[CustomerAccess] No managed customer key from backend, invalidating local managed key',
      )
      this.applyTransition(transitionCustomerAccess(this.accessState, { type: 'key_missing' }))
    } catch (error) {
      log.warn('[CustomerAccess] Refresh failed:', error)
    }
  }

  public async startCheckout(plan: SubscriptionPlan = 'explorer'): Promise<void> {
    const status = this.accessState.customerSubscriptionStatus
    if (status === 'polling' || status === 'awaiting_checkout') {
      log.warn('[CustomerAccess] Checkout already in progress')
      return
    }

    const deviceId = this.deviceIdentity.getDeviceId()
    const url = new URL('/subscription/checkout', MANAGED_KEY_CONFIG.BACKEND_URL)
    url.searchParams.set('device_id', deviceId)
    url.searchParams.set('plan', plan)

    this.applyTransition(transitionCustomerAccess(this.accessState, { type: 'checkout_started' }))
    await shell.openExternal(url.toString())
    log.info('[CustomerAccess] Opened checkout in system browser, starting key polling')
    this.startPolling(deviceId)
  }

  public async openSubscriptionPortal(): Promise<void> {
    const deviceId = this.deviceIdentity.getDeviceId()
    const url = new URL('/subscription/portal', MANAGED_KEY_CONFIG.BACKEND_URL)
    url.searchParams.set('device_id', deviceId)

    await shell.openExternal(url.toString())
    log.info('[CustomerAccess] Opened subscription portal in system browser')
  }

  public async activateEnterpriseLicense(_activationKey: string): Promise<void> {
    void _activationKey
    throw new Error('Enterprise activation is only available in the enterprise edition')
  }

  public startPeriodicRefresh(): void {
    if (this.refreshTimer !== null) return

    void this.refreshAccessState()

    this.refreshTimer = setInterval(() => {
      void this.refreshAccessState()
    }, MANAGED_KEY_CONFIG.KEY_REFRESH_INTERVAL_MS)
    this.refreshTimer.unref?.()
  }

  public stopPeriodicRefresh(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
    this.clearTimers()
  }

  private startPolling(deviceId: string): void {
    this.clearTimers()
    this.setState(setCustomerPolling(this.accessState))

    this.pollTimer = setInterval(() => {
      void this.pollForKey(deviceId)
    }, MANAGED_KEY_CONFIG.POLL_INTERVAL_MS)

    this.timeoutTimer = setTimeout(() => {
      log.warn('[CustomerAccess] Checkout polling timed out')
      this.clearTimers()
      this.applyTransition(
        transitionCustomerAccess(this.accessState, {
          type: 'poll_timed_out',
          error: 'Checkout timed out. Please try again.',
        }),
      )
    }, MANAGED_KEY_CONFIG.POLL_TIMEOUT_MS)
  }

  private async pollForKey(deviceId: string): Promise<void> {
    try {
      const key = await this.fetchCustomerKey(deviceId)
      if (!key) return

      log.info('[CustomerAccess] Received managed customer key')
      this.clearTimers()
      this.applyTransition(
        transitionCustomerAccess(this.accessState, {
          type: 'key_received',
          key,
        }),
      )
    } catch (error) {
      log.warn('[CustomerAccess] Poll request failed:', error)
    }
  }

  private async fetchCustomerKey(deviceId: string): Promise<string | null> {
    const url = new URL('/subscription/key', MANAGED_KEY_CONFIG.BACKEND_URL)
    url.searchParams.set('device_id', deviceId)

    const response = await fetch(url.toString())
    if (!response.ok) {
      if (response.status >= 500) {
        log.warn(`[CustomerAccess] Customer key server error: ${response.status}`)
      }
      return null
    }

    const data = (await response.json()) as { key?: string | null }
    return data.key ?? null
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

  private applyTransition(transition: CustomerAccessTransition): void {
    this.setState(transition.state, transition.payload)
  }
}
