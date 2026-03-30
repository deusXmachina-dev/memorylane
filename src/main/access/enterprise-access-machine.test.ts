import { describe, expect, it } from 'vitest'
import type { AccessState } from '../../shared/types'
import { transitionEnterpriseAccess } from './enterprise-access-machine'

function makeState(overrides: Partial<AccessState> = {}): AccessState {
  return {
    edition: 'enterprise',
    isEnterpriseActivated: false,
    customerSubscriptionStatus: null,
    enterpriseActivationStatus: 'idle',
    error: null,
    ...overrides,
  }
}

describe('enterprise access machine', () => {
  it('moves into activating when activation starts', () => {
    const result = transitionEnterpriseAccess(makeState(), { type: 'activation_started' })
    expect(result.state.enterpriseActivationStatus).toBe('activating')
    expect(result.state.isEnterpriseActivated).toBe(false)
  })

  it('marks enterprise as inactive and invalidates managed key when status is false', () => {
    const result = transitionEnterpriseAccess(makeState({ isEnterpriseActivated: true }), {
      type: 'activation_inactive',
    })
    expect(result.state.enterpriseActivationStatus).toBe('inactive')
    expect(result.state.isEnterpriseActivated).toBe(false)
    expect(result.payload).toEqual({ invalidate: true })
  })

  it('tracks activated-without-key separately from activated-with-key', () => {
    const waiting = transitionEnterpriseAccess(makeState(), {
      type: 'activation_confirmed_without_key',
    })
    expect(waiting.state.enterpriseActivationStatus).toBe('waiting_for_key')
    expect(waiting.state.isEnterpriseActivated).toBe(true)

    const completed = transitionEnterpriseAccess(waiting.state, {
      type: 'activation_completed',
      key: 'sk-or-managed',
    })
    expect(completed.state.enterpriseActivationStatus).toBe('activated')
    expect(completed.payload).toEqual({ key: 'sk-or-managed' })
  })

  it('captures activation errors without clearing prior activation flag implicitly', () => {
    const result = transitionEnterpriseAccess(makeState({ isEnterpriseActivated: true }), {
      type: 'activation_failed',
      error: 'License status request failed (500)',
    })
    expect(result.state.enterpriseActivationStatus).toBe('error')
    expect(result.state.error).toBe('License status request failed (500)')
    expect(result.state.isEnterpriseActivated).toBe(true)
  })
})
