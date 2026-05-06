import { shell } from 'electron'
import { MANAGED_KEY_CONFIG } from '../../shared/constants'
import type { ConsentOutcome, PendingConsent, SubscriptionPlan } from '../../shared/types'
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
    let signedUrl: string
    try {
      signedUrl = await this.fetchSignedLink('/v2/subscription/checkout-link', deviceId, { plan })
    } catch (error) {
      log.warn('[CustomerAccess] Failed to mint checkout link:', error)
      this.applyTransition(
        transitionCustomerAccess(this.accessState, {
          type: 'poll_timed_out',
          error: 'Could not start checkout. Please try again.',
        }),
      )
      return
    }

    this.applyTransition(transitionCustomerAccess(this.accessState, { type: 'checkout_started' }))
    await shell.openExternal(signedUrl)
    log.info('[CustomerAccess] Opened checkout in system browser, starting key polling')
    this.startPolling(deviceId)
  }

  public async openSubscriptionPortal(): Promise<void> {
    const deviceId = this.deviceIdentity.getDeviceId()
    const signedUrl = await this.fetchSignedLink('/v2/subscription/portal-link', deviceId)
    await shell.openExternal(signedUrl)
    log.info('[CustomerAccess] Opened subscription portal in system browser')
  }

  /**
   * Exchange the device_id (Bearer-authed) for a single-use signed URL the
   * system browser can open. Keeps device_id out of URLs entirely — the
   * returned URL carries a short-lived JWT instead.
   */
  private async fetchSignedLink(
    path: '/v2/subscription/checkout-link' | '/v2/subscription/portal-link',
    deviceId: string,
    body?: Record<string, string>,
  ): Promise<string> {
    const endpoint = new URL(path, MANAGED_KEY_CONFIG.BACKEND_URL).toString()
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${deviceId}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body ?? {}),
    })
    if (!response.ok) {
      throw new Error(`Backend returned ${response.status} for ${path}`)
    }
    const data = (await response.json()) as { url?: string }
    if (typeof data.url !== 'string' || data.url.length === 0) {
      throw new Error(`Backend response for ${path} missing url`)
    }
    return data.url
  }

  public async activateEnterpriseLicense(_activationCode: string): Promise<void> {
    void _activationCode
    throw new Error('Enterprise activation is only available in the enterprise edition')
  }

  public async getPendingConsent(): Promise<PendingConsent | null> {
    return null
  }

  public async submitConsentDecision(_outcome: ConsentOutcome): Promise<void> {
    void _outcome
    throw new Error('Consent decisions are only available in the enterprise edition')
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

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${deviceId}` },
    })
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
