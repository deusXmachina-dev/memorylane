import { describe, expect, it } from 'vitest'
import type { AccessState } from '../../shared/types'
import { createInitialAccessState, requiresActivation } from './types'

function enterprise(overrides: Partial<AccessState>): AccessState {
  return { ...createInitialAccessState('enterprise'), ...overrides }
}

describe('requiresActivation', () => {
  it('never blocks the customer edition', () => {
    expect(requiresActivation(createInitialAccessState('customer'))).toBe(false)
  })

  it('blocks every enterprise state that is not activated', () => {
    for (const status of ['idle', 'inactive', 'activating', 'awaiting_consent', 'error'] as const) {
      expect(requiresActivation(enterprise({ enterpriseActivationStatus: status }))).toBe(true)
    }
  })

  it('allows an activated device, with or without a key or a transient error', () => {
    for (const status of ['activated', 'waiting_for_key', 'error'] as const) {
      expect(
        requiresActivation(
          enterprise({ isEnterpriseActivated: true, enterpriseActivationStatus: status }),
        ),
      ).toBe(false)
    }
  })
})
