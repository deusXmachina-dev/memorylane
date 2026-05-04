import type { AccessState } from '../../shared/types'
import type { ManagedInferenceConfig } from './enterprise-access-machine'

export type CustomerAccessEvent =
  | { type: 'checkout_started' }
  | { type: 'key_received'; key: string }
  | { type: 'key_missing' }
  | { type: 'poll_timed_out'; error: string }
  | { type: 'request_failed'; error: string }

export interface CustomerAccessTransition {
  state: AccessState
  payload?: {
    config?: ManagedInferenceConfig
    invalidate?: boolean
  }
}

export function transitionCustomerAccess(
  state: AccessState,
  event: CustomerAccessEvent,
): CustomerAccessTransition {
  switch (event.type) {
    case 'checkout_started':
      return {
        state: {
          ...state,
          customerSubscriptionStatus: 'awaiting_checkout',
          error: null,
        },
      }
    case 'key_received':
      return {
        state: {
          ...state,
          customerSubscriptionStatus: 'idle',
          error: null,
        },
        payload: {
          config: { provider: 'openrouter', apiKey: event.key },
        },
      }
    case 'key_missing':
      return {
        state: {
          ...state,
          customerSubscriptionStatus: 'idle',
          error: null,
        },
        payload: {
          invalidate: true,
        },
      }
    case 'poll_timed_out':
    case 'request_failed':
      return {
        state: {
          ...state,
          customerSubscriptionStatus: 'error',
          error: event.error,
        },
      }
  }
}

export function setCustomerPolling(state: AccessState): AccessState {
  return {
    ...state,
    customerSubscriptionStatus: 'polling',
    error: null,
  }
}
