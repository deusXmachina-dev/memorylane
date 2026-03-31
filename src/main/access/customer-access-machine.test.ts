import { describe, expect, it } from 'vitest'
import type { AccessState } from '../../shared/types'
import { setCustomerPolling, transitionCustomerAccess } from './customer-access-machine'

function makeState(overrides: Partial<AccessState> = {}): AccessState {
  return {
    edition: 'customer',
    isEnterpriseActivated: false,
    customerSubscriptionStatus: 'idle',
    enterpriseActivationStatus: null,
    error: null,
    ...overrides,
  }
}

describe('customer access machine', () => {
  it('enters awaiting_checkout when checkout starts', () => {
    const result = transitionCustomerAccess(makeState(), { type: 'checkout_started' })
    expect(result.state.customerSubscriptionStatus).toBe('awaiting_checkout')
    expect(result.state.error).toBeNull()
  })

  it('enters polling via helper without mutating other state', () => {
    const state = makeState({ error: 'old' })
    expect(setCustomerPolling(state)).toEqual({
      ...state,
      customerSubscriptionStatus: 'polling',
      error: null,
    })
  })

  it('returns a managed-key payload when a key is received', () => {
    const result = transitionCustomerAccess(makeState({ customerSubscriptionStatus: 'polling' }), {
      type: 'key_received',
      key: 'sk-or-managed',
    })
    expect(result.state.customerSubscriptionStatus).toBe('idle')
    expect(result.payload).toEqual({ key: 'sk-or-managed' })
  })

  it('returns an invalidation payload when no key is available', () => {
    const result = transitionCustomerAccess(makeState(), { type: 'key_missing' })
    expect(result.state.customerSubscriptionStatus).toBe('idle')
    expect(result.payload).toEqual({ invalidate: true })
  })

  it('captures timeout errors explicitly', () => {
    const result = transitionCustomerAccess(makeState({ customerSubscriptionStatus: 'polling' }), {
      type: 'poll_timed_out',
      error: 'Checkout timed out',
    })
    expect(result.state.customerSubscriptionStatus).toBe('error')
    expect(result.state.error).toBe('Checkout timed out')
  })
})
