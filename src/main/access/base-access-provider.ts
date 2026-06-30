import type {
  AccessState,
  ConsentOutcome,
  PendingConsent,
  SubscriptionPlan,
} from '../../shared/types'
import log from '@main/utils/logger'
import { DeviceIdentityUnavailableError, type DeviceIdentity } from '../settings/device-identity'
import type { AccessProvider, AccessStateCallback, AccessUpdatePayload } from './types'

/** User-facing message for a transient secure-storage hiccup in an interactive flow. */
export const DEVICE_IDENTITY_RETRY_MESSAGE =
  'Secure storage is temporarily unavailable. Please try again in a moment.'

export abstract class BaseAccessProvider implements AccessProvider {
  protected accessState: AccessState
  protected onUpdate: AccessStateCallback | null = null
  protected readonly deviceIdentity: DeviceIdentity

  protected constructor(initialState: AccessState, deviceIdentity: DeviceIdentity) {
    this.accessState = initialState
    this.deviceIdentity = deviceIdentity
  }

  /**
   * Read the device id, treating a transient DeviceIdentityUnavailableError as
   * "skip this pass" (returns null). Callers must bail without changing access
   * state, so a recoverable secure-storage hiccup never invalidates a key or
   * de-activates the device. Non-transient errors propagate.
   */
  protected resolveDeviceIdOrSkip(): string | null {
    try {
      return this.deviceIdentity.getDeviceId()
    } catch (error) {
      if (error instanceof DeviceIdentityUnavailableError) {
        log.warn('[AccessProvider] Device identity unavailable, skipping refresh:', error.message)
        return null
      }
      throw error
    }
  }

  /**
   * Read the device id for an interactive (user-initiated) flow. A transient
   * DeviceIdentityUnavailableError is rethrown as a clean, retryable error so
   * the UI can prompt a retry — we never proceed to the backend with a missing
   * or regenerated id. Non-transient errors propagate unchanged.
   */
  protected resolveDeviceIdInteractive(): string {
    try {
      return this.deviceIdentity.getDeviceId()
    } catch (error) {
      if (error instanceof DeviceIdentityUnavailableError) {
        throw new Error(DEVICE_IDENTITY_RETRY_MESSAGE, { cause: error })
      }
      throw error
    }
  }

  public getAccessState(): AccessState {
    return this.accessState
  }

  public setUpdateCallback(callback: AccessStateCallback): void {
    this.onUpdate = callback
  }

  public abstract refreshAccessState(): Promise<void>
  public abstract startPeriodicRefresh(): void
  public abstract stopPeriodicRefresh(): void
  public abstract startCheckout(plan?: SubscriptionPlan): Promise<void>
  public abstract openSubscriptionPortal(): Promise<void>
  public abstract activateEnterpriseLicense(activationCode: string): Promise<void>
  public abstract getPendingConsent(): Promise<PendingConsent | null>
  public abstract submitConsentDecision(outcome: ConsentOutcome): Promise<void>

  protected setState(next: Partial<AccessState>, payload?: AccessUpdatePayload): void {
    this.accessState = {
      ...this.accessState,
      ...next,
    }
    this.onUpdate?.(this.accessState, payload)
  }
}
