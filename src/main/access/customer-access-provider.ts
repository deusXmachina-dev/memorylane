import { shell } from 'electron'
import { MANAGED_KEY_CONFIG } from '../../shared/constants'
import type { ConsentOutcome, PendingConsent, SubscriptionPlan } from '../../shared/types'
import { isSameRegistrableDomain } from '../../shared/url-utils'
import log from '@main/utils/logger'
import type { DeviceIdentity } from '../settings/device-identity'
import { BaseAccessProvider } from './base-access-provider'
import {
  setCustomerPolling,
  transitionCustomerAccess,
  type CustomerAccessTransition,
} from './customer-access-machine'
import { createInitialAccessState } from './types'

type KeyFetchResult = { kind: 'key'; key: string } | { kind: 'no_key' } | { kind: 'transient' }

export class CustomerAccessProvider extends BaseAccessProvider {
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null
  private refreshTimer: ReturnType<typeof setInterval> | null = null

  constructor(deviceIdentity: DeviceIdentity) {
    super(createInitialAccessState('customer'), deviceIdentity)
  }

  public async refreshAccessState(): Promise<void> {
    const status = this.accessState.customerSubscriptionStatus
    if (status === 'polling' || status === 'awaiting_checkout') {
      return
    }

    // Transient identity failure: don't invalidate the managed key. The periodic refresh retries.
    const deviceId = this.resolveDeviceIdOrSkip()
    if (deviceId === null) return

    const result = await this.fetchCustomerKey(deviceId)
    switch (result.kind) {
      case 'key':
        log.info('[CustomerAccess] Received managed customer key')
        this.applyTransition(
          transitionCustomerAccess(this.accessState, { type: 'key_received', key: result.key }),
        )
        return
      case 'no_key':
        log.info(
          '[CustomerAccess] Backend reports no managed customer key, invalidating local managed key',
        )
        this.applyTransition(transitionCustomerAccess(this.accessState, { type: 'key_missing' }))
        return
      case 'transient':
        return
    }
  }

  public async startCheckout(plan: SubscriptionPlan = 'explorer'): Promise<void> {
    const status = this.accessState.customerSubscriptionStatus
    if (status === 'polling' || status === 'awaiting_checkout') {
      log.warn('[CustomerAccess] Checkout already in progress')
      return
    }

    let deviceId: string
    let signedUrl: string
    try {
      deviceId = this.resolveDeviceIdInteractive()
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
    const deviceId = this.resolveDeviceIdInteractive()
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
    // Defence-in-depth: if the backend is ever compromised it could return a
    // phishing URL we'd then hand to `shell.openExternal`. Constrain the
    // returned URL to the same registrable domain as our backend.
    if (!isSameRegistrableDomain(data.url, MANAGED_KEY_CONFIG.BACKEND_URL)) {
      throw new Error(`Backend returned URL outside backend domain for ${path}`)
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
    const result = await this.fetchCustomerKey(deviceId)
    if (result.kind !== 'key') return

    log.info('[CustomerAccess] Received managed customer key')
    this.clearTimers()
    this.applyTransition(
      transitionCustomerAccess(this.accessState, { type: 'key_received', key: result.key }),
    )
  }

  private async fetchCustomerKey(deviceId: string): Promise<KeyFetchResult> {
    const url = new URL('/v2/subscription/key', MANAGED_KEY_CONFIG.BACKEND_URL)
    const deviceIdHint = `${deviceId.slice(0, 4)}…${deviceId.slice(-4)}`

    let response: Response
    try {
      response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${deviceId}` },
      })
    } catch (error) {
      log.warn(
        `[CustomerAccess] /v2/subscription/key request failed for device ${deviceIdHint}:`,
        error,
      )
      return { kind: 'transient' }
    }

    if (!response.ok) {
      // Only a structured (JSON) error body carries signal. HTML error pages —
      // e.g. a backend 404 "Page not found" — are noise, so for those we log
      // just the status + content-type rather than dumping a slab of markup.
      const contentType = response.headers?.get('content-type') ?? ''
      const bodyExcerpt = contentType.includes('json')
        ? `: ${(await response.text().catch(() => '')).slice(0, 200)}`
        : ''
      log.warn(
        `[CustomerAccess] /v2/subscription/key returned ${response.status} (${contentType || 'no content-type'}) for device ${deviceIdHint}${bodyExcerpt}`,
      )
      if (response.status === 401 || response.status === 403) {
        return { kind: 'no_key' }
      }
      return { kind: 'transient' }
    }

    let data: { key?: string | null }
    try {
      data = (await response.json()) as { key?: string | null }
    } catch (error) {
      log.warn(
        `[CustomerAccess] /v2/subscription/key returned malformed JSON for device ${deviceIdHint}:`,
        error,
      )
      return { kind: 'transient' }
    }

    if (data.key == null) {
      log.info(`[CustomerAccess] /v2/subscription/key returned no key for device ${deviceIdHint}`)
      return { kind: 'no_key' }
    }
    return { kind: 'key', key: data.key }
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
