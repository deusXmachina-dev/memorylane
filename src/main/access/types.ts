import type { AppEdition } from '../../shared/edition'
import type {
  AccessState,
  ConsentOutcome,
  PendingConsent,
  SubscriptionPlan,
} from '../../shared/types'
import type { ManagedInferenceConfig } from './enterprise-access-machine'

export interface AccessUpdatePayload {
  error?: string
  config?: ManagedInferenceConfig
  invalidate?: boolean
}

export type AccessStateCallback = (state: AccessState, payload?: AccessUpdatePayload) => void

export interface AccessProvider {
  getAccessState(): AccessState
  setUpdateCallback(callback: AccessStateCallback): void
  refreshAccessState(): Promise<void>
  startPeriodicRefresh(): void
  stopPeriodicRefresh(): void
  startCheckout(plan?: SubscriptionPlan): Promise<void>
  openSubscriptionPortal(): Promise<void>
  activateEnterpriseLicense(activationCode: string): Promise<void>
  getPendingConsent(): Promise<PendingConsent | null>
  submitConsentDecision(outcome: ConsentOutcome): Promise<void>
}

export function createInitialAccessState(edition: AppEdition): AccessState {
  return {
    edition,
    isEnterpriseActivated: false,
    customerSubscriptionStatus: edition === 'customer' ? 'idle' : null,
    enterpriseActivationStatus: edition === 'enterprise' ? 'idle' : null,
    error: null,
  }
}
