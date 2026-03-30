import { ENTERPRISE_LICENSE_CONFIG } from '../../shared/constants'
import log from '../logger'
import type { DeviceIdentity } from '../settings/device-identity'
import { BaseAccessProvider } from './base-access-provider'
import {
  transitionEnterpriseAccess,
  type EnterpriseAccessTransition,
} from './enterprise-access-machine'
import { createInitialAccessState } from './types'

export class EnterpriseAccessProvider extends BaseAccessProvider {
  private readonly deviceIdentity: DeviceIdentity
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null
  private refreshTimer: ReturnType<typeof setInterval> | null = null

  constructor(deviceIdentity: DeviceIdentity) {
    super(createInitialAccessState('enterprise'))
    this.deviceIdentity = deviceIdentity
  }

  public async refreshAccessState(): Promise<void> {
    const deviceId = this.deviceIdentity.getDeviceId()
    try {
      const activated = await this.fetchEnterpriseStatus(deviceId)
      if (!activated) {
        log.info('[EnterpriseAccess] Device is not activated')
        this.applyTransition(
          transitionEnterpriseAccess(this.accessState, { type: 'activation_inactive' }),
        )
        return
      }

      const key = await this.fetchEnterpriseKey(deviceId)
      if (key) {
        log.info('[EnterpriseAccess] Received enterprise managed key')
        this.applyTransition(
          transitionEnterpriseAccess(this.accessState, {
            type: 'activation_completed',
            key,
          }),
        )
        return
      }

      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, {
          type: 'activation_confirmed_without_key',
        }),
      )
    } catch (error) {
      log.warn('[EnterpriseAccess] Refresh failed:', error)
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, {
          type: 'activation_failed',
          error: error instanceof Error ? error.message : 'Failed to refresh activation state',
        }),
      )
    }
  }

  public async activateEnterpriseLicense(activationKey: string): Promise<void> {
    const trimmedKey = activationKey.trim()
    if (trimmedKey.length === 0) {
      throw new Error('Activation key is required')
    }

    if (
      this.accessState.enterpriseActivationStatus === 'activating' ||
      this.accessState.enterpriseActivationStatus === 'waiting_for_key'
    ) {
      log.warn('[EnterpriseAccess] Activation already in progress')
      return
    }

    const deviceId = this.deviceIdentity.getDeviceId()
    this.applyTransition(
      transitionEnterpriseAccess(this.accessState, { type: 'activation_started' }),
    )

    const response = await fetch(
      new URL('/license/activate', ENTERPRISE_LICENSE_CONFIG.BACKEND_URL),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          device_id: deviceId,
          activation_key: trimmedKey,
        }),
      },
    )

    if (!response.ok) {
      const errorMessage = await this.readErrorMessage(response, 'Activation failed')
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, {
          type: 'activation_failed',
          error: errorMessage,
        }),
      )
      throw new Error(errorMessage)
    }

    log.info('[EnterpriseAccess] Activation accepted, polling for activation state')
    this.startActivationPolling(deviceId)
  }

  public async startCheckout(): Promise<void> {
    throw new Error('Checkout is only available in the customer edition')
  }

  public async openSubscriptionPortal(): Promise<void> {
    throw new Error('Subscription portal is only available in the customer edition')
  }

  public startPeriodicRefresh(): void {
    if (this.refreshTimer !== null) return

    void this.refreshAccessState()

    this.refreshTimer = setInterval(() => {
      void this.refreshAccessState()
    }, ENTERPRISE_LICENSE_CONFIG.STATUS_REFRESH_INTERVAL_MS)
    this.refreshTimer.unref?.()
  }

  public stopPeriodicRefresh(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
    this.clearTimers()
  }

  private startActivationPolling(deviceId: string): void {
    this.clearTimers()
    void this.pollForActivation(deviceId)

    this.pollTimer = setInterval(() => {
      void this.pollForActivation(deviceId)
    }, ENTERPRISE_LICENSE_CONFIG.POLL_INTERVAL_MS)

    this.timeoutTimer = setTimeout(() => {
      log.warn('[EnterpriseAccess] Activation polling timed out')
      this.clearTimers()
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, {
          type: 'activation_failed',
          error: 'Activation timed out while waiting for key provisioning.',
        }),
      )
    }, ENTERPRISE_LICENSE_CONFIG.ACTIVATION_TIMEOUT_MS)
  }

  private async pollForActivation(deviceId: string): Promise<void> {
    try {
      const activated = await this.fetchEnterpriseStatus(deviceId)
      if (!activated) {
        this.applyTransition(
          transitionEnterpriseAccess(this.accessState, { type: 'activation_started' }),
        )
        return
      }

      const key = await this.fetchEnterpriseKey(deviceId)
      if (!key) {
        this.applyTransition(
          transitionEnterpriseAccess(this.accessState, {
            type: 'activation_confirmed_without_key',
          }),
        )
        return
      }

      this.clearTimers()
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, {
          type: 'activation_completed',
          key,
        }),
      )
    } catch (error) {
      log.warn('[EnterpriseAccess] Activation poll failed:', error)
    }
  }

  private async fetchEnterpriseStatus(deviceId: string): Promise<boolean> {
    const url = new URL('/license/status', ENTERPRISE_LICENSE_CONFIG.BACKEND_URL)
    url.searchParams.set('device_id', deviceId)

    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error(`License status request failed (${response.status})`)
    }

    const data = (await response.json()) as { activated?: boolean }
    if (typeof data.activated !== 'boolean') {
      throw new Error('License status response is missing a valid activated boolean')
    }

    return data.activated
  }

  private async fetchEnterpriseKey(deviceId: string): Promise<string | null> {
    const url = new URL('/license/key', ENTERPRISE_LICENSE_CONFIG.BACKEND_URL)
    url.searchParams.set('device_id', deviceId)

    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error(`License key request failed (${response.status})`)
    }

    const data = (await response.json()) as { key?: string | null }
    if (!('key' in data)) {
      throw new Error('License key response is missing the key field')
    }
    if (typeof data.key !== 'string' && data.key !== null) {
      throw new Error('License key response must contain a string or null key')
    }

    return data.key
  }

  private async readErrorMessage(response: Response, fallback: string): Promise<string> {
    try {
      const data = (await response.json()) as { error?: string }
      return typeof data.error === 'string' && data.error.trim() !== '' ? data.error : fallback
    } catch {
      return fallback
    }
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

  private applyTransition(transition: EnterpriseAccessTransition): void {
    this.setState(transition.state, transition.payload)
  }
}
