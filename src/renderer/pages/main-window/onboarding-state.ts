// Pure step-resolution helpers for the renderer-driven onboarding flow.
//
// Extracted from MainWindowApp so the state machine is testable in isolation:
// derive the step list, decide which step is the leading edge, layer an
// optional back-navigation override, and gate the forward arrow.

import type { OnboardingStepId, OnboardingStepInfo } from './components/onboarding/OnboardingLayout'
import type { PermissionStatus } from '@types'

export type DisplayStep = OnboardingStepId | 'dashboard'

const CONSUMER_STEPS: OnboardingStepInfo[] = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'plan', label: 'Plan' },
  { id: 'connect', label: 'Connect' },
  { id: 'blacklist', label: 'Privacy' },
  { id: 'capture', label: 'Capture' },
]

const ENTERPRISE_STEPS: OnboardingStepInfo[] = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'activation', label: 'Activate' },
  { id: 'blacklist', label: 'Privacy' },
  { id: 'capture', label: 'Capture' },
]

export function getOnboardingSteps(isEnterprise: boolean): OnboardingStepInfo[] {
  return isEnterprise ? ENTERPRISE_STEPS : CONSUMER_STEPS
}

export interface OnboardingInputs {
  isEnterprise: boolean
  isConfigured: boolean
  lastCompletedStepIndex: number
  permissionStatus: PermissionStatus | null
  permissionRestartPending: boolean
  hasAnyProgress: boolean
  anyMcpConnected: boolean
  viewStepOverride: OnboardingStepId | null
  platform: NodeJS.Platform
  hasExistingActivities: boolean
}

export interface OnboardingResolution {
  steps: OnboardingStepInfo[]
  displaySteps: OnboardingStepInfo[]
  computedStep: DisplayStep
  computedIndex: number
  displayStep: DisplayStep
  displayIndex: number
  overrideValid: boolean
  canGoBack: boolean
  canGoForward: boolean
}

/**
 * macOS is the only platform with TCC permissions the user can fail. On other
 * platforms `getPermissionStatus()` hard-codes both fields to `granted`, so the
 * Permissions step has nothing to do — filter it from the stepper UI and treat
 * it as auto-complete in the resolution logic. Canonical step indices are kept
 * stable; only the displayed list is filtered.
 */
function isPermissionsStepRelevant(platform: NodeJS.Platform): boolean {
  return platform === 'darwin'
}

/**
 * Permissions are "granted" once both permissions are reported granted by
 * macOS AND no mid-session restart is pending. Returns `null` when status
 * hasn't loaded yet — callers should distinguish "unknown" from "denied".
 */
export function arePermissionsGranted(
  permissionStatus: PermissionStatus | null,
  permissionRestartPending: boolean,
): boolean | null {
  if (permissionStatus === null) return null
  return (
    permissionStatus.accessibility === 'granted' &&
    permissionStatus.screenRecording === 'granted' &&
    !permissionRestartPending
  )
}

/**
 * Per-step completion. Requirement-driven steps (permissions, plan,
 * activation) auto-complete when their underlying state is satisfied — they
 * can be revoked outside the app, so we always check live state.
 * User-action steps (connect, blacklist, capture) require an explicit
 * click-through tracked by `lastCompletedStepIndex`. Welcome is content-only
 * and auto-completes once any other progress signal exists so returning users
 * aren't re-walked through it.
 *
 * For the Permissions step, while `permissionStatus === null` (loading) we
 * treat it as complete IF the user already clicked through it before — this
 * avoids a flicker through the step on returning-user reloads. For new users
 * (`lastCompletedStepIndex < permissionsIdx`), it remains incomplete.
 */
function isStepComplete(id: OnboardingStepId, idx: number, inputs: OnboardingInputs): boolean {
  const {
    lastCompletedStepIndex,
    isConfigured,
    hasAnyProgress,
    permissionStatus,
    permissionRestartPending,
    platform,
  } = inputs
  switch (id) {
    case 'welcome':
      return lastCompletedStepIndex >= idx || hasAnyProgress
    case 'permissions': {
      // Non-darwin platforms have nothing to grant — skip the step entirely.
      if (!isPermissionsStepRelevant(platform)) return true
      const granted = arePermissionsGranted(permissionStatus, permissionRestartPending)
      // Loading: only treat as complete if the user previously clicked through.
      if (granted === null) return lastCompletedStepIndex >= idx
      return granted && lastCompletedStepIndex >= idx
    }
    case 'plan':
      return isConfigured && lastCompletedStepIndex >= idx
    case 'activation':
      return isConfigured
    default:
      return lastCompletedStepIndex >= idx
  }
}

function canStepGoForward(step: DisplayStep, inputs: OnboardingInputs): boolean {
  if (step === 'dashboard') return false
  switch (step) {
    case 'welcome':
      return true
    case 'permissions': {
      if (!isPermissionsStepRelevant(inputs.platform)) return true
      const granted = arePermissionsGranted(
        inputs.permissionStatus,
        inputs.permissionRestartPending,
      )
      // While loading, do NOT enable forward — a fast click could advance past
      // the step before its UI even appears.
      return granted === true
    }
    case 'plan':
    case 'activation':
      return inputs.isConfigured
    case 'connect':
    case 'blacklist':
    case 'capture':
      return true
    default:
      return false
  }
}

export function resolveOnboarding(inputs: OnboardingInputs): OnboardingResolution {
  const steps = getOnboardingSteps(inputs.isEnterprise)
  const displaySteps = isPermissionsStepRelevant(inputs.platform)
    ? steps
    : steps.filter((s) => s.id !== 'permissions')

  const computedStepIndex = steps.findIndex((s, idx) => !isStepComplete(s.id, idx, inputs))
  const computedStep: DisplayStep =
    computedStepIndex === -1 ? 'dashboard' : steps[computedStepIndex].id
  const computedIndex = computedStep === 'dashboard' ? steps.length : computedStepIndex

  // Resolve an optional back-navigation override. The override lets the user
  // navigate backward through already-visited steps without mutating real
  // state (granted permissions, saved keys can't be reasonably "undone").
  // Once the user reaches the dashboard, ignore any override.
  const overrideIndex =
    inputs.viewStepOverride !== null ? steps.findIndex((s) => s.id === inputs.viewStepOverride) : -1
  const overrideValid =
    computedStep !== 'dashboard' && overrideIndex !== -1 && overrideIndex < computedIndex
  const displayStep: DisplayStep = overrideValid
    ? (inputs.viewStepOverride as OnboardingStepId)
    : computedStep
  const displayIndex = overrideValid ? overrideIndex : computedIndex

  const canGoBack = displayIndex > 0 && displayStep !== 'dashboard'
  const canGoForward = canStepGoForward(displayStep, inputs)

  return {
    steps,
    displaySteps,
    computedStep,
    computedIndex,
    displayStep,
    displayIndex,
    overrideValid,
    canGoBack,
    canGoForward,
  }
}

/**
 * Self-heal `lastCompletedStepIndex` from concrete state. If a returning user
 * has already granted permissions, set a key, or connected MCP, those steps
 * are implicitly done — return the highest index that's implied by live state
 * so the caller can bump the mark forward.
 *
 * Returns -1 if nothing is implied.
 */
export function impliedCompletedIndex(inputs: OnboardingInputs): number {
  const {
    isEnterprise,
    isConfigured,
    permissionStatus,
    hasAnyProgress,
    anyMcpConnected,
    hasExistingActivities,
    platform,
  } = inputs
  const steps = getOnboardingSteps(isEnterprise)
  // Existing recordings mean the user was fully onboarded in some prior
  // session; localStorage may have been wiped (reinstall, profile reset).
  // Skip the entire flow rather than walking them back through it.
  if (hasExistingActivities) return steps.length - 1
  let implied = -1
  if (hasAnyProgress) implied = Math.max(implied, 0) // welcome
  if (
    isPermissionsStepRelevant(platform) &&
    permissionStatus !== null &&
    permissionStatus.accessibility === 'granted' &&
    permissionStatus.screenRecording === 'granted'
  ) {
    const idx = steps.findIndex((s) => s.id === 'permissions')
    if (idx !== -1) implied = Math.max(implied, idx)
  }
  if (isConfigured) {
    const planIdx = steps.findIndex((s) => s.id === 'plan')
    const actIdx = steps.findIndex((s) => s.id === 'activation')
    if (planIdx !== -1) implied = Math.max(implied, planIdx)
    if (actIdx !== -1) implied = Math.max(implied, actIdx)
  }
  if (anyMcpConnected) {
    const idx = steps.findIndex((s) => s.id === 'connect')
    if (idx !== -1) implied = Math.max(implied, idx)
  }
  return implied
}
