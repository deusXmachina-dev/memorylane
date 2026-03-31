import type { AppEdition } from '../../shared/edition'
import type { AccessState, SubscriptionPlan } from '../../shared/types'

export interface AccessUpdatePayload {
  error?: string
  key?: string
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
  activateEnterpriseLicense(activationKey: string): Promise<void>
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
