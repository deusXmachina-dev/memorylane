import type { AccessState } from '../../shared/types'

export type EnterpriseAccessEvent =
  | { type: 'activation_started' }
  | { type: 'activation_inactive' }
  | { type: 'activation_confirmed_without_key' }
  | { type: 'activation_completed'; key: string }
  | { type: 'activation_failed'; error: string }

export interface EnterpriseAccessTransition {
  state: AccessState
  payload?: {
    key?: string
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
          key: event.key,
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
