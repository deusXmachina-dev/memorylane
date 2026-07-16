import { createHash } from 'node:crypto'
import { ENTERPRISE_BACKEND_CONFIG } from '../../shared/constants'
import type { ConsentOutcome, PendingConsent } from '../../shared/types'
import log from '@main/utils/logger'
import { describeNetworkError } from '@main/utils/network-error'
import type { DeviceIdentity } from '../settings/device-identity'
import { parseActivationCode } from './activation-code'
import { BaseAccessProvider, DEVICE_IDENTITY_RETRY_MESSAGE } from './base-access-provider'
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

type ParsedConsentDescriptor =
  | { kind: 'already_approved' }
  | {
      kind: 'required'
      url: string
      version: number
      sha256: string
      title: string
      contentType: AllowedConsentContentType
    }

function parseConsentDescriptor(raw: unknown): ParsedConsentDescriptor {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('Consent descriptor is malformed.')
  }
  const obj = raw as Record<string, unknown>

  if (obj.state === 'already_approved') {
    return { kind: 'already_approved' }
  }
  if (obj.state !== undefined && obj.state !== 'required') {
    throw new Error('Consent descriptor is malformed.')
  }
  if (
    typeof obj.url !== 'string' ||
    typeof obj.version !== 'number' ||
    typeof obj.sha256 !== 'string' ||
    typeof obj.title !== 'string'
  ) {
    throw new Error('Consent descriptor is malformed.')
  }
  const rawContentType = typeof obj.content_type === 'string' ? obj.content_type : undefined
  const contentType = normalizeConsentContentType(rawContentType)
  if (contentType === null) {
    throw new Error(`Unsupported consent document type: ${rawContentType ?? 'unknown'}`)
  }
  return {
    kind: 'required',
    url: obj.url,
    version: obj.version,
    sha256: obj.sha256,
    title: obj.title,
    contentType,
  }
}

interface ActivateResponse {
  ok?: boolean
  declined?: boolean
}

type ActivateResult =
  | { status: 'ok'; data: ActivateResponse }
  | { status: 'provisioning_pending'; message: string }
  | { status: 'error'; message: string }

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

export class EnterpriseAccessProvider extends BaseAccessProvider {
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private consentTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null
  private pendingConsent: PendingConsentState | null = null

  constructor(deviceIdentity: DeviceIdentity) {
    super(createInitialAccessState('enterprise'), deviceIdentity)
  }

  private resolveBackendBase(): string {
    return ENTERPRISE_BACKEND_CONFIG.BACKEND_URL.replace(/\/?$/, '/')
  }

  private enterpriseUrl(path: string): URL {
    return new URL(path, this.resolveBackendBase())
  }

  /** fetch() that rethrows transport failures with a user-facing message. */
  private async fetchMapped(url: string | URL, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(url.toString(), init)
    } catch (error) {
      log.warn('[EnterpriseAccess] Network request failed:', error)
      const friendly = describeNetworkError(error)
      throw friendly !== null ? new Error(friendly) : error
    }
  }

  public async refreshAccessState(): Promise<void> {
    if (this.accessState.enterpriseActivationStatus === 'awaiting_consent') {
      return
    }
    // Transient identity failure: don't transition to activation_failed, which
    // would falsely de-activate the device. The periodic refresh retries.
    const deviceId = this.resolveDeviceIdOrSkip()
    if (deviceId === null) return
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

    let parsed: { tenantToken: string; email: string }
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

    this.applyTransition(
      transitionEnterpriseAccess(this.accessState, { type: 'activation_started' }),
    )

    const descriptorUrl = this.enterpriseUrl('api/license/consent-document')

    let descriptorResponse: Response
    try {
      descriptorResponse = await this.fetchMapped(descriptorUrl, {
        headers: bearer(parsed.tenantToken),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Activation failed.'
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, {
          type: 'activation_failed',
          error: message,
        }),
      )
      throw new Error(message)
    }
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

    let descriptor: ParsedConsentDescriptor
    try {
      descriptor = parseConsentDescriptor(await descriptorResponse.json())
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Consent descriptor is malformed.'
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, {
          type: 'activation_failed',
          error: errorMessage,
        }),
      )
      throw new Error(errorMessage)
    }

    if (descriptor.kind === 'already_approved') {
      log.info('[EnterpriseAccess] Consent pre-approved by backend; skipping consent UI')
      await this.bindWithExternalConsent(parsed.tenantToken, parsed.email)
      return
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
      contentType: descriptor.contentType,
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

    // Transient identity failure: throw a clean retry error without touching
    // state, leaving the consent prompt open so the user can resubmit.
    const deviceId = this.resolveDeviceIdInteractive()
    const result = await this.postActivate(
      {
        tenant_token: pending.tenantToken,
        device_id: deviceId,
        email: pending.email,
        document_version: pending.version,
        outcome,
      },
      pending.tenantToken,
      'Consent request failed',
    )

    if (result.status === 'provisioning_pending' && outcome === 'accepted') {
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

    if (result.status !== 'ok') {
      this.clearConsentTimeout()
      this.pendingConsent = null
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, {
          type: 'activation_failed',
          error: result.message,
        }),
      )
      throw new Error(result.message)
    }

    if (outcome === 'declined' || result.data.declined === true) {
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

  private async bindWithExternalConsent(tenantToken: string, email: string): Promise<void> {
    // Transient identity failure mid-activation: surface activation_failed (not a
    // stuck 'activating' state) and throw a clean retry error.
    let deviceId: string
    try {
      deviceId = this.resolveDeviceIdInteractive()
    } catch (error) {
      const message = error instanceof Error ? error.message : DEVICE_IDENTITY_RETRY_MESSAGE
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, { type: 'activation_failed', error: message }),
      )
      throw new Error(message)
    }
    const result = await this.postActivate(
      { tenant_token: tenantToken, device_id: deviceId, email, outcome: 'accepted' },
      tenantToken,
      'Activation failed during external-consent bind',
    )

    if (result.status === 'error') {
      this.applyTransition(
        transitionEnterpriseAccess(this.accessState, {
          type: 'activation_failed',
          error: result.message,
        }),
      )
      throw new Error(result.message)
    }

    if (result.status === 'provisioning_pending') {
      log.warn(
        '[EnterpriseAccess] External-consent bind reported downstream provisioning failure; polling',
      )
    } else {
      log.info('[EnterpriseAccess] External-consent bind succeeded; polling for activation state')
    }
    this.startActivationPolling(deviceId)
  }

  private async postActivate(
    body: Record<string, unknown>,
    tenantToken: string,
    errorFallback: string,
  ): Promise<ActivateResult> {
    const response = await this.fetchMapped(this.enterpriseUrl('api/license/activate'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...bearer(tenantToken),
      },
      body: JSON.stringify(body),
    })

    if (response.status === 502) {
      return {
        status: 'provisioning_pending',
        message: await this.readErrorMessage(response, errorFallback),
      }
    }
    if (!response.ok) {
      return { status: 'error', message: await this.readErrorMessage(response, errorFallback) }
    }
    return { status: 'ok', data: (await response.json()) as ActivateResponse }
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
    const backendBase = this.resolveBackendBase()
    const documentUrl = new URL(url, backendBase)
    if (documentUrl.origin !== new URL(backendBase).origin) {
      throw new Error('Consent document URL is not on the configured backend origin')
    }
    const response = await this.fetchMapped(documentUrl, {
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
    const url = this.enterpriseUrl('api/license/status')

    const response = await this.fetchMapped(url, { headers: bearer(deviceId) })
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
    const url = this.enterpriseUrl('api/license/inference-config')

    const response = await this.fetchMapped(url, { headers: bearer(deviceId) })
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
