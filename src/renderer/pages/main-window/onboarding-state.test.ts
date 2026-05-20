import { describe, expect, it } from 'vitest'
import {
  arePermissionsGranted,
  getOnboardingSteps,
  impliedCompletedIndex,
  nextOverrideDisplayStep,
  previousDisplayStep,
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
    platform: 'darwin',
    hasExistingActivities: false,
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

  it('returns last consumer index when hasExistingActivities (re-install scenario)', () => {
    // User has DB data but blank localStorage — treat as fully onboarded.
    expect(impliedCompletedIndex(baseInputs({ hasExistingActivities: true }))).toBe(5)
  })

  it('returns last enterprise index when hasExistingActivities', () => {
    expect(
      impliedCompletedIndex(baseInputs({ isEnterprise: true, hasExistingActivities: true })),
    ).toBe(4)
  })

  it('does not bump implied past permissions on non-darwin even when granted', () => {
    // On Windows getPermissionStatus auto-returns granted, but that grant is
    // trivial and should not imply progress beyond welcome.
    expect(
      impliedCompletedIndex(
        baseInputs({ platform: 'win32', permissionStatus: GRANTED, hasAnyProgress: false }),
      ),
    ).toBe(-1)
  })
})

describe('resolveOnboarding — non-darwin (Windows/Linux) platform', () => {
  it('consumer Windows: displaySteps has 5 steps, no permissions', () => {
    const r = resolveOnboarding(baseInputs({ platform: 'win32' }))
    expect(r.steps.map((s) => s.id)).toContain('permissions') // canonical untouched
    expect(r.displaySteps.map((s) => s.id)).toEqual([
      'welcome',
      'plan',
      'connect',
      'blacklist',
      'capture',
    ])
  })

  it('enterprise Windows: displaySteps has 4 steps, no permissions', () => {
    const r = resolveOnboarding(baseInputs({ platform: 'win32', isEnterprise: true }))
    expect(r.displaySteps.map((s) => s.id)).toEqual([
      'welcome',
      'activation',
      'blacklist',
      'capture',
    ])
  })

  it('consumer macOS: displaySteps still has 6 steps including permissions', () => {
    const r = resolveOnboarding(baseInputs({ platform: 'darwin' }))
    expect(r.displaySteps.map((s) => s.id)).toEqual([
      'welcome',
      'permissions',
      'plan',
      'connect',
      'blacklist',
      'capture',
    ])
  })

  it('enterprise macOS: displaySteps has 5 steps including permissions', () => {
    const r = resolveOnboarding(baseInputs({ platform: 'darwin', isEnterprise: true }))
    expect(r.displaySteps.map((s) => s.id)).toEqual([
      'welcome',
      'permissions',
      'activation',
      'blacklist',
      'capture',
    ])
  })

  it('linux is treated like Windows: permissions filtered out', () => {
    const r = resolveOnboarding(baseInputs({ platform: 'linux' }))
    expect(r.displaySteps.map((s) => s.id)).not.toContain('permissions')
    expect(r.displaySteps).toHaveLength(5)
  })

  it('auto-skips Permissions step on Windows: after welcome → plan', () => {
    const r = resolveOnboarding(baseInputs({ platform: 'win32', lastCompletedStepIndex: 0 }))
    expect(r.computedStep).toBe('plan')
  })

  it('Windows enterprise: after welcome → activation (skips permissions)', () => {
    const r = resolveOnboarding(
      baseInputs({ platform: 'win32', isEnterprise: true, lastCompletedStepIndex: 0 }),
    )
    expect(r.computedStep).toBe('activation')
  })

  it('Windows: existing activities → dashboard', () => {
    const r = resolveOnboarding(baseInputs({ platform: 'win32', hasExistingActivities: true }))
    // impliedCompletedIndex would push lastCompletedStepIndex to 5 in MainWindowApp,
    // but resolveOnboarding alone needs both signals to short-circuit.
    // Simulate post-self-heal state:
    const r2 = resolveOnboarding(
      baseInputs({
        platform: 'win32',
        hasExistingActivities: true,
        lastCompletedStepIndex: 5,
        isConfigured: true,
      }),
    )
    expect(r2.computedStep).toBe('dashboard')
    // First call (pre-self-heal) still works — every prior step is either
    // auto-complete (permissions on Windows) or content-only (welcome).
    expect(r.computedStep).not.toBe('permissions')
  })

  it('canGoBack from plan on Windows: previous displayed step is welcome', () => {
    // The renderer-side handleBack uses displaySteps, but resolveOnboarding's
    // canGoBack still reflects whether any earlier displayed step exists.
    const r = resolveOnboarding(baseInputs({ platform: 'win32', lastCompletedStepIndex: 0 }))
    expect(r.displayStep).toBe('plan')
    expect(r.canGoBack).toBe(true)
  })

  it('rejects a viewStepOverride pointing at a hidden step (permissions on Windows)', () => {
    // Defense-in-depth: the renderer only sets overrides from displaySteps, but
    // a stale value must not resolve to a step the stepper UI doesn't render.
    const r = resolveOnboarding(
      baseInputs({
        platform: 'win32',
        lastCompletedStepIndex: 3,
        isConfigured: true,
        viewStepOverride: 'permissions',
      }),
    )
    expect(r.overrideValid).toBe(false)
    expect(r.displayStep).not.toBe('permissions')
  })
})

describe('resolveOnboarding — existing activities short-circuit', () => {
  it('returns dashboard once lastCompletedStepIndex covers all steps', () => {
    const r = resolveOnboarding(
      baseInputs({
        hasExistingActivities: true,
        lastCompletedStepIndex: 5,
        permissionStatus: GRANTED,
        isConfigured: true,
      }),
    )
    expect(r.computedStep).toBe('dashboard')
  })
})

describe('canGoBack is anchored to displaySteps', () => {
  it('Windows at plan (canonical idx 2): canGoBack reflects displayed prev (welcome)', () => {
    const r = resolveOnboarding(baseInputs({ platform: 'win32', lastCompletedStepIndex: 0 }))
    expect(r.displayStep).toBe('plan')
    // welcome is at displayedPosition 0 < plan at displayedPosition 1, so back is allowed.
    expect(r.canGoBack).toBe(true)
  })

  it('macOS at welcome: canGoBack=false (first displayed step)', () => {
    const r = resolveOnboarding(baseInputs({ platform: 'darwin' }))
    expect(r.displayStep).toBe('welcome')
    expect(r.canGoBack).toBe(false)
  })

  it('Windows at welcome: canGoBack=false even though canonical idx 1 is filtered out', () => {
    const r = resolveOnboarding(baseInputs({ platform: 'win32' }))
    expect(r.displayStep).toBe('welcome')
    expect(r.canGoBack).toBe(false)
  })
})

describe('previousDisplayStep', () => {
  it('returns the prior displayed step', () => {
    const consumer = getOnboardingSteps(false)
    expect(previousDisplayStep('plan', consumer)).toBe('permissions')
  })

  it('skips filtered (Windows) steps — back from plan goes to welcome, not permissions', () => {
    const consumer = getOnboardingSteps(false)
    const windowsDisplay = consumer.filter((s) => s.id !== 'permissions')
    expect(previousDisplayStep('plan', windowsDisplay)).toBe('welcome')
  })

  it('returns null at the first displayed step', () => {
    const consumer = getOnboardingSteps(false)
    expect(previousDisplayStep('welcome', consumer)).toBeNull()
  })

  it('returns null when displayStep is not in the displayed list (e.g. dashboard)', () => {
    const consumer = getOnboardingSteps(false)
    expect(previousDisplayStep('dashboard', consumer)).toBeNull()
  })
})

describe('nextOverrideDisplayStep', () => {
  it('advances through the displayed list, skipping filtered steps on Windows', () => {
    // User is at welcome (override), has actually progressed to connect (canonical idx 3).
    // Next override target should be plan — NOT permissions, which is filtered.
    const consumer = getOnboardingSteps(false)
    const windowsDisplay = consumer.filter((s) => s.id !== 'permissions')
    const computedIndex = consumer.findIndex((s) => s.id === 'connect') // 3
    expect(nextOverrideDisplayStep('welcome', windowsDisplay, consumer, computedIndex)).toBe('plan')
  })

  it('returns null when the next displayed step would catch up to the computed edge', () => {
    // Computed edge is plan (idx 2). User is at welcome via override. plan IS the edge,
    // so override can't advance to it — caller should perform the real continue action.
    const consumer = getOnboardingSteps(false)
    const windowsDisplay = consumer.filter((s) => s.id !== 'permissions')
    const computedIndex = consumer.findIndex((s) => s.id === 'plan') // 2
    expect(nextOverrideDisplayStep('welcome', windowsDisplay, consumer, computedIndex)).toBeNull()
  })

  it('returns null when displayStep is the last displayed entry', () => {
    const consumer = getOnboardingSteps(false)
    expect(nextOverrideDisplayStep('capture', consumer, consumer, consumer.length)).toBeNull()
  })

  it('macOS unfiltered: welcome → permissions when permissions is the override target', () => {
    const consumer = getOnboardingSteps(false)
    const computedIndex = consumer.findIndex((s) => s.id === 'plan') // 2
    expect(nextOverrideDisplayStep('welcome', consumer, consumer, computedIndex)).toBe(
      'permissions',
    )
  })
})
