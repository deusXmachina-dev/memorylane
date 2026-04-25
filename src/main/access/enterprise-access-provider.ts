import { ENTERPRISE_BACKEND_CONFIG } from '../../shared/constants'
import type { ConsentOutcome, PendingConsent } from '../../shared/types'
import log from '../logger'
import type { DeviceIdentity } from '../settings/device-identity'
import { BaseAccessProvider } from './base-access-provider'
import {
  transitionEnterpriseAccess,
  type EnterpriseAccessTransition,
} from './enterprise-access-machine'
import { createInitialAccessState } from './types'

interface PendingConsentState {
  activationKey: string
  version: number
  sha256: string
  title: string
  contentType: AllowedConsentContentType
}

const ALLOWED_CONSENT_CONTENT_TYPES = ['application/pdf'] as const
type AllowedConsentContentType = (typeof ALLOWED_CONSENT_CONTENT_TYPES)[number]

function normalizeConsentContentType(raw: string | undefined): AllowedConsentContentType | null {
  if (typeof raw !== 'string') return null
  const base = raw.split(';')[0]?.trim().toLowerCase()
  if (base === undefined) return null
  return (ALLOWED_CONSENT_CONTENT_TYPES as readonly string[]).includes(base)
    ? (base as AllowedConsentContentType)
    : null
}

interface ProbeConsentPayload {
  url: string
  version: number
  sha256: string
  title: string
  content_type: string
}

interface ProbeResponse {
  ok: boolean
  consent: ProbeConsentPayload | null
}

interface ConsentResponse {
  ok: boolean
  declined: boolean
}

function enterpriseUrl(path: string): URL {
  const base = ENTERPRISE_BACKEND_CONFIG.BACKEND_URL.replace(/\/?$/, '/')
  return new URL(path, base)
}

export class EnterpriseAccessProvider extends BaseAccessProvider {
  private readonly deviceIdentity: DeviceIdentity
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private consentTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  private pendingConsent: PendingConsentState | null = null

  constructor(deviceIdentity: DeviceIdentity) {
    super(createInitialAccessState('enterprise'))
    this.deviceIdentity = deviceIdentity
  }

  public async refreshAccessState(): Promise<void> {
    if (this.accessState.enterpriseActivationStatus === 'awaiting_consent') {
      return
    }
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
      this.accessState.enterpriseActivationStatus === 'waiting_for_key' ||
      this.accessState.enterpriseActivationStatus === 'awaiting_consent'
    ) {
      log.warn('[EnterpriseAccess] Activation already in progress')
      return
    }

    const deviceId = this.deviceIdentity.getDeviceId()
    this.applyTransition(
      transitionEnterpriseAccess(this.accessState, { type: 'activation_started' }),
    )

    const response = await fetch(enterpriseUrl('license/activate'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        device_id: deviceId,
        activation_key: trimmedKey,
      }),
    })

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

    const probe = (await response.json()) as Partial<ProbeResponse>
    if (probe.ok === false) {
      if (!probe.consent) {
        const errorMessage = 'Activation rejected by server.'
        this.applyTransition(
          transitionEnterpriseAccess(this.accessState, {
            type: 'activation_failed',
            error: errorMessage,
          }),
        )
        throw new Error(errorMessage)
      }

      const contentType = normalizeConsentContentType(probe.consent.content_type)
      if (contentType === null) {
        const errorMessage = `Unsupported consent document type: ${probe.consent.content_type}`
        this.applyTransition(
          transitionEnterpriseAccess(this.accessState, {
            type: 'activation_failed',
            error: errorMessage,
          }),
        )
        throw new Error(errorMessage)
      }

      this.pendingConsent = {
        activationKey: trimmedKey,
        version: probe.consent.version,
        sha256: probe.consent.sha256,
        title: probe.consent.title,
        contentType,
      }
      log.info('[EnterpriseAccess] Consent required before activation can complete')
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, { type: 'consent_required' }),
      )
      this.startConsentTimeout()
      return
    }

    log.info('[EnterpriseAccess] Activation accepted, polling for activation state')
    this.startActivationPolling(deviceId)
  }

  public async getPendingConsent(): Promise<PendingConsent | null> {
    const pending = this.pendingConsent
    if (pending === null) return null

    const url = enterpriseUrl(`license/consent-document/${encodeURIComponent(pending.sha256)}`)
    const response = await fetch(url.toString())
    if (!response.ok) {
      throw new Error(`Consent document request failed (${response.status})`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    return {
      title: pending.title,
      contentType: pending.contentType,
      bytesBase64: buffer.toString('base64'),
    }
  }

  public async submitConsentDecision(outcome: ConsentOutcome): Promise<void> {
    const pending = this.pendingConsent
    if (pending === null) {
      throw new Error('No consent decision pending')
    }

    const deviceId = this.deviceIdentity.getDeviceId()
    const response = await fetch(enterpriseUrl('license/consent'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        device_id: deviceId,
        activation_key: pending.activationKey,
        document_version: pending.version,
        outcome,
      }),
    })

    if (response.status === 502 && outcome === 'accepted') {
      log.warn(
        '[EnterpriseAccess] Consent accepted but downstream key provisioning failed; polling',
      )
      this.clearConsentTimeout()
      this.pendingConsent = null
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, { type: 'consent_decision_accepted' }),
      )
      this.startActivationPolling(deviceId)
      return
    }

    if (!response.ok) {
      const errorMessage = await this.readErrorMessage(response, 'Consent request failed')
      this.clearConsentTimeout()
      this.pendingConsent = null
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, {
          type: 'activation_failed',
          error: errorMessage,
        }),
      )
      throw new Error(errorMessage)
    }

    const data = (await response.json()) as Partial<ConsentResponse>

    if (outcome === 'declined' || data.declined === true) {
      log.info('[EnterpriseAccess] User declined consent; resetting activation state')
      this.clearConsentTimeout()
      this.pendingConsent = null
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, { type: 'activation_inactive' }),
      )
      return
    }

    log.info('[EnterpriseAccess] Consent accepted; polling for activation state')
    this.clearConsentTimeout()
    this.pendingConsent = null
    this.applyTransition(
      transitionEnterpriseAccess(this.accessState, { type: 'consent_decision_accepted' }),
    )
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
    }, ENTERPRISE_BACKEND_CONFIG.STATUS_REFRESH_INTERVAL_MS)
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
    }, ENTERPRISE_BACKEND_CONFIG.POLL_INTERVAL_MS)

    this.timeoutTimer = setTimeout(() => {
      log.warn('[EnterpriseAccess] Activation polling timed out')
      this.clearTimers()
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, {
          type: 'activation_failed',
          error: 'Activation timed out while waiting for key provisioning.',
        }),
      )
    }, ENTERPRISE_BACKEND_CONFIG.ACTIVATION_TIMEOUT_MS)
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
    const url = enterpriseUrl('license/status')
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
    const url = enterpriseUrl('license/key')
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
    this.clearConsentTimeout()
  }

  private startConsentTimeout(): void {
    this.clearConsentTimeout()
    this.consentTimeoutTimer = setTimeout(() => {
      log.warn('[EnterpriseAccess] Consent decision timed out')
      this.consentTimeoutTimer = null
      this.pendingConsent = null
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, {
          type: 'activation_failed',
          error: 'Consent decision timed out. Re-enter your activation key to try again.',
        }),
      )
    }, ENTERPRISE_BACKEND_CONFIG.CONSENT_DECISION_TIMEOUT_MS)
    this.consentTimeoutTimer.unref?.()
  }

  private clearConsentTimeout(): void {
    if (this.consentTimeoutTimer !== null) {
      clearTimeout(this.consentTimeoutTimer)
      this.consentTimeoutTimer = null
    }
  }

  private applyTransition(transition: EnterpriseAccessTransition): void {
    this.setState(transition.state, transition.payload)
  }
}
