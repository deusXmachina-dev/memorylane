import { createHash } from 'node:crypto'
import { ENTERPRISE_BACKEND_CONFIG } from '../../shared/constants'
import type { ConsentOutcome, PendingConsent } from '../../shared/types'
import log from '../logger'
import type { DeviceIdentity } from '../settings/device-identity'
import type { EnterpriseLicenseConfig } from '../settings/enterprise-license-config'
import { parseActivationCode } from './activation-code'
import { BaseAccessProvider } from './base-access-provider'
import {
  transitionEnterpriseAccess,
  type EnterpriseAccessTransition,
  ManagedInferenceConfig,
} from './enterprise-access-machine'
import { createInitialAccessState } from './types'

const TOKEN_REFRESH_LEAD_MS = 60_000
const TOKEN_REFRESH_MIN_MS = 30_000

interface PendingConsentState {
  tenantToken: string
  email: string
  version: number
  sha256: string
  title: string
  contentType: AllowedConsentContentType
  bytesBase64: string
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

interface ConsentDescriptorPayload {
  url: string
  version: number
  sha256: string
  title: string
  content_type: string
}

interface ActivateResponse {
  ok?: boolean
  declined?: boolean
}

function enterpriseUrl(path: string): URL {
  const base = ENTERPRISE_BACKEND_CONFIG.BACKEND_URL.replace(/\/?$/, '/')
  return new URL(path, base)
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

export class EnterpriseAccessProvider extends BaseAccessProvider {
  private readonly deviceIdentity: DeviceIdentity
  private readonly licenseConfig: EnterpriseLicenseConfig | null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private consentTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null
  private pendingConsent: PendingConsentState | null = null

  constructor(deviceIdentity: DeviceIdentity, licenseConfig?: EnterpriseLicenseConfig) {
    super(createInitialAccessState('enterprise'))
    this.deviceIdentity = deviceIdentity
    this.licenseConfig = licenseConfig ?? null
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
        this.clearTokenRefresh()
        this.applyTransition(
          transitionEnterpriseAccess(this.accessState, { type: 'activation_inactive' }),
        )
        return
      }

      const config = await this.fetchInferenceConfig(deviceId)
      if (config) {
        log.info(`[EnterpriseAccess] Received managed inference config (${config.provider})`)
        this.scheduleTokenRefresh(deviceId, config)
        this.applyTransition(
          transitionEnterpriseAccess(this.accessState, {
            type: 'activation_completed',
            config,
          }),
        )
        return
      }

      this.clearTokenRefresh()
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

  public async activateEnterpriseLicense(activationCode: string): Promise<void> {
    if (
      this.accessState.enterpriseActivationStatus === 'activating' ||
      this.accessState.enterpriseActivationStatus === 'waiting_for_key' ||
      this.accessState.enterpriseActivationStatus === 'awaiting_consent'
    ) {
      log.warn('[EnterpriseAccess] Activation already in progress')
      return
    }

    let parsed: { tenantToken: string; email: string; backendUrl: string | null }
    try {
      parsed = parseActivationCode(activationCode)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Activation code is malformed.'
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, {
          type: 'activation_failed',
          error: message,
        }),
      )
      throw new Error(message)
    }

    if (parsed.backendUrl !== null && this.licenseConfig !== null) {
      this.licenseConfig.setBackendUrl(parsed.backendUrl)
    }

    this.applyTransition(
      transitionEnterpriseAccess(this.accessState, { type: 'activation_started' }),
    )

    const descriptorUrl = enterpriseUrl('license/consent-document')

    const descriptorResponse = await fetch(descriptorUrl.toString(), {
      headers: bearer(parsed.tenantToken),
    })
    if (!descriptorResponse.ok) {
      const errorMessage = await this.readErrorMessage(
        descriptorResponse,
        'Activation failed to fetch consent document.',
      )
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, {
          type: 'activation_failed',
          error: errorMessage,
        }),
      )
      throw new Error(errorMessage)
    }

    const descriptor = (await descriptorResponse.json()) as Partial<ConsentDescriptorPayload>
    if (
      typeof descriptor.url !== 'string' ||
      typeof descriptor.version !== 'number' ||
      typeof descriptor.sha256 !== 'string' ||
      typeof descriptor.title !== 'string'
    ) {
      const errorMessage = 'Consent descriptor is malformed.'
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, {
          type: 'activation_failed',
          error: errorMessage,
        }),
      )
      throw new Error(errorMessage)
    }

    const contentType = normalizeConsentContentType(descriptor.content_type)
    if (contentType === null) {
      const errorMessage = `Unsupported consent document type: ${descriptor.content_type ?? 'unknown'}`
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, {
          type: 'activation_failed',
          error: errorMessage,
        }),
      )
      throw new Error(errorMessage)
    }

    let documentBytesBase64: string
    try {
      documentBytesBase64 = await this.fetchAndVerifyConsentDocument(
        descriptor.url,
        descriptor.sha256,
        parsed.tenantToken,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch consent document.'
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, {
          type: 'activation_failed',
          error: message,
        }),
      )
      throw new Error(message)
    }

    this.pendingConsent = {
      tenantToken: parsed.tenantToken,
      email: parsed.email,
      version: descriptor.version,
      sha256: descriptor.sha256,
      title: descriptor.title,
      contentType,
      bytesBase64: documentBytesBase64,
    }
    log.info('[EnterpriseAccess] Consent required before activation can complete')
    this.applyTransition(transitionEnterpriseAccess(this.accessState, { type: 'consent_required' }))
    this.startConsentTimeout()
  }

  public async getPendingConsent(): Promise<PendingConsent | null> {
    const pending = this.pendingConsent
    if (pending === null) return null

    return {
      title: pending.title,
      contentType: pending.contentType,
      bytesBase64: pending.bytesBase64,
    }
  }

  public async submitConsentDecision(outcome: ConsentOutcome): Promise<void> {
    const pending = this.pendingConsent
    if (pending === null) {
      throw new Error('No consent decision pending')
    }

    const deviceId = this.deviceIdentity.getDeviceId()
    const response = await fetch(enterpriseUrl('license/activate'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...bearer(pending.tenantToken),
      },
      body: JSON.stringify({
        tenant_token: pending.tenantToken,
        device_id: deviceId,
        email: pending.email,
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

    const data = (await response.json()) as ActivateResponse

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
    this.clearTokenRefresh()
  }

  private async fetchAndVerifyConsentDocument(
    url: string,
    expectedSha256: string,
    tenantToken: string,
  ): Promise<string> {
    const backendBase = ENTERPRISE_BACKEND_CONFIG.BACKEND_URL.replace(/\/?$/, '/')
    const documentUrl = new URL(url, backendBase)
    if (documentUrl.origin !== new URL(backendBase).origin) {
      throw new Error('Consent document URL is not on the configured backend origin')
    }
    const response = await fetch(documentUrl.toString(), {
      headers: bearer(tenantToken),
    })
    if (!response.ok) {
      throw new Error(`Consent document request failed (${response.status})`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    const actualSha256 = createHash('sha256').update(buffer).digest('hex')
    const expected = expectedSha256.toLowerCase()
    if (actualSha256 !== expected) {
      log.warn(
        '[EnterpriseAccess] Consent document hash mismatch',
        `expected=${expected}`,
        `actual=${actualSha256}`,
      )
      throw new Error('Consent document failed integrity check')
    }
    return buffer.toString('base64')
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

      const config = await this.fetchInferenceConfig(deviceId)
      if (!config) {
        this.applyTransition(
          transitionEnterpriseAccess(this.accessState, {
            type: 'activation_confirmed_without_key',
          }),
        )
        return
      }

      this.clearTimers()
      this.scheduleTokenRefresh(deviceId, config)
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, {
          type: 'activation_completed',
          config,
        }),
      )
    } catch (error) {
      log.warn('[EnterpriseAccess] Activation poll failed:', error)
    }
  }

  private async fetchEnterpriseStatus(deviceId: string): Promise<boolean> {
    const url = enterpriseUrl('license/status')

    const response = await fetch(url.toString(), { headers: bearer(deviceId) })
    if (response.status === 401) {
      return false
    }
    if (!response.ok) {
      throw new Error(`License status request failed (${response.status})`)
    }

    const data = (await response.json()) as { activated?: boolean }
    if (typeof data.activated !== 'boolean') {
      throw new Error('License status response is missing a valid activated boolean')
    }

    return data.activated
  }

  private async fetchInferenceConfig(deviceId: string): Promise<ManagedInferenceConfig | null> {
    const url = enterpriseUrl('license/inference-config')

    const response = await fetch(url.toString(), { headers: bearer(deviceId) })
    if (response.status === 401) {
      return null
    }
    if (!response.ok) {
      throw new Error(`Inference config request failed (${response.status})`)
    }

    const data = (await response.json()) as {
      provider?: 'openrouter' | 'vertex' | null
      apiKey?: string | null
      project?: string | null
      location?: string | null
      expiresAt?: number | null
    }

    if (data.provider == null || data.apiKey == null) {
      return null
    }
    if (data.provider !== 'openrouter' && data.provider !== 'vertex') {
      throw new Error(`Inference config has unknown provider: ${String(data.provider)}`)
    }
    if (typeof data.apiKey !== 'string' || data.apiKey.length === 0) {
      throw new Error('Inference config apiKey must be a non-empty string')
    }

    if (data.provider === 'vertex') {
      if (typeof data.project !== 'string' || data.project.length === 0) {
        throw new Error('Vertex inference config is missing project')
      }
      if (typeof data.location !== 'string' || data.location.length === 0) {
        throw new Error('Vertex inference config is missing location')
      }
      const config: ManagedInferenceConfig = {
        provider: 'vertex',
        apiKey: data.apiKey,
        project: data.project,
        location: data.location,
      }
      if (typeof data.expiresAt === 'number' && Number.isFinite(data.expiresAt)) {
        config.expiresAt = data.expiresAt
      }
      return config
    }

    return { provider: 'openrouter', apiKey: data.apiKey }
  }

  private scheduleTokenRefresh(deviceId: string, config: ManagedInferenceConfig): void {
    this.clearTokenRefresh()
    if (config.provider !== 'vertex' || config.expiresAt === undefined) {
      return
    }
    const msUntilRefresh = Math.max(
      TOKEN_REFRESH_MIN_MS,
      config.expiresAt * 1000 - Date.now() - TOKEN_REFRESH_LEAD_MS,
    )
    log.info(
      `[EnterpriseAccess] Vertex token refresh scheduled in ${Math.round(msUntilRefresh / 1000)}s`,
    )
    this.tokenRefreshTimer = setTimeout(() => {
      this.tokenRefreshTimer = null
      void this.refreshAccessState()
    }, msUntilRefresh)
    this.tokenRefreshTimer.unref?.()
  }

  private clearTokenRefresh(): void {
    if (this.tokenRefreshTimer !== null) {
      clearTimeout(this.tokenRefreshTimer)
      this.tokenRefreshTimer = null
    }
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
          error: 'Consent decision timed out. Re-enter your activation code to try again.',
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
