import type { AccessState } from '../../shared/types'

export interface ManagedInferenceConfig {
  provider: 'openrouter' | 'vertex'
  apiKey: string
  /** Vertex only. */
  project?: string
  /** Vertex only. */
  location?: string
  /** Vertex only — unix seconds. Token expiry; consumer should refetch before. */
  expiresAt?: number
}

export type EnterpriseAccessEvent =
  | { type: 'activation_started' }
  | { type: 'activation_inactive' }
  | { type: 'consent_required' }
  | { type: 'consent_decision_accepted' }
  | { type: 'activation_confirmed_without_key' }
  | { type: 'activation_completed'; config: ManagedInferenceConfig }
  | { type: 'activation_failed'; error: string }

export interface EnterpriseAccessTransition {
  state: AccessState
  payload?: {
    config?: ManagedInferenceConfig
    invalidate?: boolean
  }
}

export function transitionEnterpriseAccess(
  state: AccessState,
  event: EnterpriseAccessEvent,
): EnterpriseAccessTransition {
  switch (event.type) {
    case 'activation_started':
      return {
        state: {
          ...state,
          isEnterpriseActivated: false,
          enterpriseActivationStatus: 'activating',
          error: null,
        },
      }
    case 'activation_inactive':
      return {
        state: {
          ...state,
          isEnterpriseActivated: false,
          enterpriseActivationStatus: 'inactive',
          error: null,
        },
        payload: {
          invalidate: true,
        },
      }
    case 'consent_required':
      return {
        state: {
          ...state,
          isEnterpriseActivated: false,
          enterpriseActivationStatus: 'awaiting_consent',
          error: null,
        },
      }
    case 'consent_decision_accepted':
      return {
        state: {
          ...state,
          isEnterpriseActivated: false,
          enterpriseActivationStatus: 'activating',
          error: null,
        },
      }
    case 'activation_confirmed_without_key':
      return {
        state: {
          ...state,
          isEnterpriseActivated: true,
          enterpriseActivationStatus: 'waiting_for_key',
          error: null,
        },
      }
    case 'activation_completed':
      return {
        state: {
          ...state,
          isEnterpriseActivated: true,
          enterpriseActivationStatus: 'activated',
          error: null,
        },
        payload: {
          config: event.config,
        },
      }
    case 'activation_failed':
      return {
        state: {
          ...state,
          enterpriseActivationStatus: 'error',
          error: event.error,
        },
      }
  }
}
