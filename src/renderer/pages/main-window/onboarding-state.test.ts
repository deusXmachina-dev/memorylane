import { describe, expect, it } from 'vitest'
import {
  arePermissionsGranted,
  getOnboardingSteps,
  impliedCompletedIndex,
  resolveOnboarding,
  type OnboardingInputs,
} from './onboarding-state'
import type { PermissionStatus } from '@types'

const GRANTED: PermissionStatus = { accessibility: 'granted', screenRecording: 'granted' }
const DENIED: PermissionStatus = { accessibility: 'denied', screenRecording: 'denied' }
const PARTIAL: PermissionStatus = { accessibility: 'granted', screenRecording: 'denied' }

function baseInputs(overrides: Partial<OnboardingInputs> = {}): OnboardingInputs {
  return {
    isEnterprise: false,
    isConfigured: false,
    lastCompletedStepIndex: -1,
    permissionStatus: null,
    permissionRestartPending: false,
    hasAnyProgress: false,
    anyMcpConnected: false,
    viewStepOverride: null,
    ...overrides,
  }
}

describe('arePermissionsGranted', () => {
  it('returns null when status is not yet loaded', () => {
    expect(arePermissionsGranted(null, false)).toBe(null)
  })

  it('returns true when both are granted and no restart pending', () => {
    expect(arePermissionsGranted(GRANTED, false)).toBe(true)
  })

  it('returns false when restart is pending even if both are granted', () => {
    expect(arePermissionsGranted(GRANTED, true)).toBe(false)
  })

  it('returns false when one permission is missing', () => {
    expect(arePermissionsGranted(PARTIAL, false)).toBe(false)
  })
})

describe('getOnboardingSteps', () => {
  it('consumer flow has 6 steps including plan and connect', () => {
    const steps = getOnboardingSteps(false)
    expect(steps.map((s) => s.id)).toEqual([
      'welcome',
      'permissions',
      'plan',
      'connect',
      'blacklist',
      'capture',
    ])
  })

  it('enterprise flow has 5 steps with activation in place of plan/connect', () => {
    const steps = getOnboardingSteps(true)
    expect(steps.map((s) => s.id)).toEqual([
      'welcome',
      'permissions',
      'activation',
      'blacklist',
      'capture',
    ])
  })
})

describe('resolveOnboarding — consumer leading-edge step', () => {
  it('fresh install: starts at welcome', () => {
    const r = resolveOnboarding(baseInputs())
    expect(r.computedStep).toBe('welcome')
    expect(r.displayStep).toBe('welcome')
    expect(r.canGoBack).toBe(false)
  })

  it('after welcome marked: leading edge moves to permissions', () => {
    const r = resolveOnboarding(baseInputs({ lastCompletedStepIndex: 0 }))
    expect(r.computedStep).toBe('permissions')
  })

  it('on permissions with status loading: cannot go forward', () => {
    const r = resolveOnboarding(baseInputs({ lastCompletedStepIndex: 0, permissionStatus: null }))
    expect(r.displayStep).toBe('permissions')
    expect(r.canGoForward).toBe(false)
  })

  it('on permissions with denied: cannot go forward', () => {
    const r = resolveOnboarding(baseInputs({ lastCompletedStepIndex: 0, permissionStatus: DENIED }))
    expect(r.canGoForward).toBe(false)
  })

  it('on permissions with granted but restart pending: cannot go forward', () => {
    const r = resolveOnboarding(
      baseInputs({
        lastCompletedStepIndex: 0,
        permissionStatus: GRANTED,
        permissionRestartPending: true,
      }),
    )
    expect(r.canGoForward).toBe(false)
  })

  it('on permissions with granted and no restart pending: can go forward', () => {
    const r = resolveOnboarding(
      baseInputs({ lastCompletedStepIndex: 0, permissionStatus: GRANTED }),
    )
    expect(r.canGoForward).toBe(true)
  })

  it('on plan without isConfigured: cannot go forward', () => {
    const r = resolveOnboarding(
      baseInputs({
        lastCompletedStepIndex: 1,
        permissionStatus: GRANTED,
      }),
    )
    expect(r.displayStep).toBe('plan')
    expect(r.canGoForward).toBe(false)
  })

  it('on plan with isConfigured: can go forward', () => {
    const r = resolveOnboarding(
      baseInputs({
        lastCompletedStepIndex: 1,
        permissionStatus: GRANTED,
        isConfigured: true,
      }),
    )
    expect(r.canGoForward).toBe(true)
  })

  it('returning user with all live state satisfied + history: dashboard', () => {
    const r = resolveOnboarding(
      baseInputs({
        lastCompletedStepIndex: 5,
        permissionStatus: GRANTED,
        isConfigured: true,
        hasAnyProgress: true,
        anyMcpConnected: true,
      }),
    )
    expect(r.computedStep).toBe('dashboard')
    expect(r.displayStep).toBe('dashboard')
    expect(r.canGoBack).toBe(false)
    expect(r.canGoForward).toBe(false)
  })

  it('permissions loading + previously completed: skips permissions (no flicker)', () => {
    // lastCompletedStepIndex=2 means welcome+permissions already clicked through.
    const r = resolveOnboarding(
      baseInputs({
        lastCompletedStepIndex: 2,
        permissionStatus: null,
      }),
    )
    // Should land on plan, not permissions.
    expect(r.computedStep).toBe('plan')
  })

  it('permissions loading + new user: stays on permissions', () => {
    const r = resolveOnboarding(
      baseInputs({
        lastCompletedStepIndex: 0,
        permissionStatus: null,
      }),
    )
    expect(r.computedStep).toBe('permissions')
  })
})

describe('resolveOnboarding — enterprise', () => {
  it('fresh enterprise install: starts at welcome', () => {
    const r = resolveOnboarding(baseInputs({ isEnterprise: true }))
    expect(r.computedStep).toBe('welcome')
    expect(r.steps).toHaveLength(5)
  })

  it('enterprise overshoot from legacy migration: lands on dashboard', () => {
    // Legacy migration may produce lastCompletedStepIndex=5 (consumer capture
    // index post-shift), but enterprise list has indices 0..4. Overshoot
    // should resolve to dashboard.
    const r = resolveOnboarding(
      baseInputs({
        isEnterprise: true,
        lastCompletedStepIndex: 5,
        permissionStatus: GRANTED,
        isConfigured: true,
        hasAnyProgress: true,
      }),
    )
    expect(r.computedStep).toBe('dashboard')
  })

  it('activation auto-completes purely on isConfigured', () => {
    const r = resolveOnboarding(
      baseInputs({
        isEnterprise: true,
        lastCompletedStepIndex: 1, // welcome + permissions clicked through
        permissionStatus: GRANTED,
        isConfigured: true,
      }),
    )
    // welcome(0), permissions(1), activation(2 — auto from isConfigured), blacklist(3)
    expect(r.computedStep).toBe('blacklist')
  })
})

describe('resolveOnboarding — back navigation override', () => {
  it('override is ignored when computed step is dashboard', () => {
    const r = resolveOnboarding(
      baseInputs({
        lastCompletedStepIndex: 5,
        permissionStatus: GRANTED,
        isConfigured: true,
        hasAnyProgress: true,
        anyMcpConnected: true,
        viewStepOverride: 'permissions',
      }),
    )
    expect(r.overrideValid).toBe(false)
    expect(r.displayStep).toBe('dashboard')
  })

  it('override is honored when it points to an earlier step', () => {
    const r = resolveOnboarding(
      baseInputs({
        lastCompletedStepIndex: 2,
        permissionStatus: GRANTED,
        viewStepOverride: 'permissions',
      }),
    )
    // computed=plan, override=permissions (earlier) → display=permissions
    expect(r.overrideValid).toBe(true)
    expect(r.displayStep).toBe('permissions')
    expect(r.displayIndex).toBe(1)
    expect(r.canGoBack).toBe(true)
  })

  it('override is rejected when it points at or past computed', () => {
    const r = resolveOnboarding(
      baseInputs({
        lastCompletedStepIndex: 0,
        permissionStatus: DENIED,
        viewStepOverride: 'plan', // ahead of computed=permissions
      }),
    )
    expect(r.overrideValid).toBe(false)
    expect(r.displayStep).toBe('permissions')
  })

  it('override is rejected if step not in current edition', () => {
    const r = resolveOnboarding(
      baseInputs({
        isEnterprise: true,
        lastCompletedStepIndex: 0,
        viewStepOverride: 'connect', // not in enterprise flow
      }),
    )
    expect(r.overrideValid).toBe(false)
  })
})

describe('impliedCompletedIndex', () => {
  it('returns -1 when nothing is implied', () => {
    expect(impliedCompletedIndex(baseInputs())).toBe(-1)
  })

  it('returns 0 (welcome) when any progress signal exists', () => {
    expect(impliedCompletedIndex(baseInputs({ hasAnyProgress: true }))).toBe(0)
  })

  it('returns permissions index when both granted', () => {
    expect(
      impliedCompletedIndex(baseInputs({ permissionStatus: GRANTED, hasAnyProgress: true })),
    ).toBe(1)
  })

  it('returns plan index (consumer) when isConfigured', () => {
    expect(impliedCompletedIndex(baseInputs({ isConfigured: true, hasAnyProgress: true }))).toBe(2)
  })

  it('returns activation index (enterprise) when isConfigured', () => {
    expect(
      impliedCompletedIndex(
        baseInputs({ isEnterprise: true, isConfigured: true, hasAnyProgress: true }),
      ),
    ).toBe(2)
  })

  it('returns connect index when MCP connected', () => {
    expect(impliedCompletedIndex(baseInputs({ anyMcpConnected: true, hasAnyProgress: true }))).toBe(
      3,
    )
  })

  it('takes the max across signals', () => {
    expect(
      impliedCompletedIndex(
        baseInputs({
          hasAnyProgress: true,
          permissionStatus: GRANTED,
          isConfigured: true,
          anyMcpConnected: true,
        }),
      ),
    ).toBe(3)
  })

  it('ignores partial permission status', () => {
    expect(
      impliedCompletedIndex(baseInputs({ permissionStatus: PARTIAL, hasAnyProgress: true })),
    ).toBe(0)
  })
})
