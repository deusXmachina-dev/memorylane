import { useCallback, useEffect, useRef, useState } from 'react'
import { Settings } from 'lucide-react'
import { Toaster } from '@components/ui/sonner'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import { useLlmHealth } from '@/renderer/hooks/use-llm-health'
import { Button } from '@components/ui/button'
import { EnterpriseActivationCard } from './components/EnterpriseActivationCard'
import { PlanPicker } from './components/PlanPicker'
import { CaptureControlSection } from './components/CaptureControlSection'
import { BlacklistStep } from './components/BlacklistStep'
import { ConnectStep } from './components/ConnectStep'
import { CaptureStep } from './components/CaptureStep'
import { StatusLine } from './components/StatusLine'
import { PatternsSection } from './components/PatternsSection'
import { AdvancedSettingsPage } from './AdvancedSettingsPage'
import {
  OnboardingLayout,
  type OnboardingStepId,
  type OnboardingStepInfo,
} from './components/OnboardingLayout'
import { WelcomeStep } from './components/WelcomeStep'
import { PermissionsStep } from './components/PermissionsStep'
import {
  LAST_COMPLETED_STEP_INDEX_KEY,
  readOrMigrateLastCompletedIndex,
  writeIntFlag,
  type OnboardingStorage,
} from './onboarding-storage'
import type { AppEditionConfig } from '@/shared/edition'
import type {
  AccessState,
  CaptureSettings,
  MainWindowStats,
  McpRegistrationStatus,
  PatternInfo,
  PermissionState,
  PermissionStatus,
  Vendor,
  VendorStatus,
} from '@types'

const localStorageAdapter: OnboardingStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
}

export function MainWindowApp(): React.JSX.Element {
  const api = useMainWindowAPI()
  const [page, setPage] = useState<'home' | 'settings'>('home')
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    'privacy' | 'data' | 'ai-models' | 'integrations' | undefined
  >(undefined)
  const [editionConfig, setEditionConfig] = useState<AppEditionConfig | null>(null)
  const [accessState, setAccessState] = useState<AccessState | null>(null)
  const [credentialStatuses, setCredentialStatuses] = useState<Record<Vendor, VendorStatus> | null>(
    null,
  )
  const [activeVendor, setActiveVendor] = useState<Vendor>('openrouter')
  const [capturing, setCapturing] = useState(false)
  const [captureHotkeyLabel, setCaptureHotkeyLabel] = useState('')
  const [toggling, setToggling] = useState(false)
  const [stats, setStats] = useState<MainWindowStats | null>(null)
  const [mcpStatus, setMcpStatus] = useState<McpRegistrationStatus | null>(null)
  const [patterns, setPatterns] = useState<PatternInfo[] | null>(null)
  const [initialLoaded, setInitialLoaded] = useState(false)
  const [lastCompletedStepIndex, setLastCompletedStepIndex] = useState<number>(() =>
    readOrMigrateLastCompletedIndex(localStorageAdapter),
  )
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus | null>(null)
  // Captured synchronously on the first non-null permission status so we can
  // detect a mid-session screen-recording grant — macOS won't let the running
  // process actually capture until it restarts, so we gate onboarding on a
  // manual restart in that case. A ref (not state) so the value is visible on
  // the same render that first sets `permissionStatus`, avoiding a one-frame
  // window where `permissionsResolved` would falsely flip true.
  const initialScreenRecordingRef = useRef<PermissionState | null>(null)
  const [viewStepOverride, setViewStepOverride] = useState<OnboardingStepId | null>(null)

  const updatePermissionStatus = useCallback((status: PermissionStatus) => {
    if (initialScreenRecordingRef.current === null) {
      initialScreenRecordingRef.current = status.screenRecording
    }
    setPermissionStatus(status)
  }, [])

  const markStepCompleted = useCallback((idx: number) => {
    setLastCompletedStepIndex((prev) => {
      const next = Math.max(prev, idx)
      if (next !== prev) writeIntFlag(localStorageAdapter, LAST_COMPLETED_STEP_INDEX_KEY, next)
      return next
    })
  }, [])

  const loadEditionConfig = useCallback(async () => {
    try {
      const config = await api.getEditionConfig()
      setEditionConfig(config)
    } catch {
      // Silently handle error
    }
  }, [api])

  const loadAccessState = useCallback(async () => {
    try {
      const state = await api.refreshAccessState()
      setAccessState(state)
    } catch {
      // Silently handle error
    }
  }, [api])

  const loadCredentials = useCallback(async () => {
    try {
      const [statuses, settings] = await Promise.all([
        api.getCredentialStatuses(),
        api.getCaptureSettings() as Promise<CaptureSettings>,
      ])
      setCredentialStatuses(statuses)
      setActiveVendor(settings.activeVendor)
    } catch {
      // Silently handle error - credential statuses will remain null
    }
  }, [api])

  const loadStats = useCallback(async () => {
    try {
      const s = await api.getStats()
      setStats(s)
    } catch {
      // Silently handle error
    }
  }, [api])

  const loadMcpStatus = useCallback(async () => {
    try {
      setMcpStatus(await api.getMcpStatus())
    } catch {
      // Silently handle error
    }
  }, [api])

  const loadPatterns = useCallback(async () => {
    try {
      setPatterns(await api.getPatterns())
    } catch {
      setPatterns([])
    }
  }, [api])

  const loadPermissionStatus = useCallback(async () => {
    try {
      updatePermissionStatus(await api.getPermissionStatus())
    } catch {
      // Silently handle error
    }
  }, [api, updatePermissionStatus])

  const loadAll = useCallback(async () => {
    await loadEditionConfig()
    await loadAccessState()
    await Promise.all([
      loadCredentials(),
      loadStats(),
      loadMcpStatus(),
      loadPatterns(),
      loadPermissionStatus(),
    ])
  }, [
    loadAccessState,
    loadEditionConfig,
    loadCredentials,
    loadStats,
    loadMcpStatus,
    loadPatterns,
    loadPermissionStatus,
  ])

  const isEnterprise = editionConfig?.edition === 'enterprise'
  const activeVendorStatus = credentialStatuses?.[activeVendor] ?? null
  const hasActiveKey = activeVendorStatus?.hasKey ?? false
  const isConfigured = isEnterprise
    ? accessState?.isEnterpriseActivated === true && hasActiveKey
    : hasActiveKey
  const { llmHealth } = useLlmHealth({
    api,
    enabled: page === 'home' && isConfigured,
  })

  const initialScreenRecording = initialScreenRecordingRef.current
  const permissionRestartPending =
    initialScreenRecording !== null &&
    initialScreenRecording !== 'granted' &&
    permissionStatus?.screenRecording === 'granted'

  const permissionsResolved =
    permissionStatus === null
      ? true // until we know, don't gate — avoids a flicker through the permissions step
      : permissionStatus.accessibility === 'granted' &&
        permissionStatus.screenRecording === 'granted' &&
        !permissionRestartPending

  type StepId =
    | 'welcome'
    | 'permissions'
    | 'plan'
    | 'activation'
    | 'connect'
    | 'blacklist'
    | 'capture'
    | 'dashboard'

  const onboardingSteps: OnboardingStepInfo[] = isEnterprise
    ? [
        { id: 'welcome', label: 'Welcome' },
        { id: 'permissions', label: 'Permissions' },
        { id: 'activation', label: 'Activate' },
        { id: 'blacklist', label: 'Privacy' },
        { id: 'capture', label: 'Capture' },
      ]
    : [
        { id: 'welcome', label: 'Welcome' },
        { id: 'permissions', label: 'Permissions' },
        { id: 'plan', label: 'Plan' },
        { id: 'connect', label: 'Connect' },
        { id: 'blacklist', label: 'Privacy' },
        { id: 'capture', label: 'Capture' },
      ]

  const anyMcpConnected = mcpStatus !== null && Object.values(mcpStatus).some(Boolean)
  const screenRecordingGranted = permissionStatus?.screenRecording === 'granted'
  const accessibilityGranted = permissionStatus?.accessibility === 'granted'
  const hasAnyProgress =
    isConfigured || screenRecordingGranted || accessibilityGranted || anyMcpConnected

  // Per-step completion. Requirement-driven steps (permissions, plan,
  // activation) auto-complete when their underlying state is satisfied —
  // they can be revoked outside the app, so we always check live state.
  // User-action steps (connect, blacklist, capture) require an explicit
  // click-through tracked by `lastCompletedStepIndex`. Welcome is
  // content-only and auto-completes once any other progress signal exists
  // so returning users aren't re-walked through it.
  const isStepComplete = (id: OnboardingStepId, idx: number): boolean => {
    switch (id) {
      case 'welcome':
        return lastCompletedStepIndex >= idx || hasAnyProgress
      case 'permissions':
        return permissionsResolved && lastCompletedStepIndex >= idx
      case 'plan':
        return isConfigured && lastCompletedStepIndex >= idx
      case 'activation':
        return isConfigured
      default:
        return lastCompletedStepIndex >= idx
    }
  }

  // First incomplete step; -1 (→ dashboard) when everything is done.
  const computedStepIndex = onboardingSteps.findIndex((s, idx) => !isStepComplete(s.id, idx))
  const computedStep: StepId =
    computedStepIndex === -1 ? 'dashboard' : (onboardingSteps[computedStepIndex].id as StepId)

  // Resolve the displayed step. The override lets the user navigate backward through
  // already-visited steps without mutating the underlying state (permissions/API key
  // can't be reasonably "undone"). Clear the override if it ever points past where the
  // state machine currently is, or to a step not in the current edition's list.
  const overrideIndex = viewStepOverride
    ? onboardingSteps.findIndex((s) => s.id === viewStepOverride)
    : -1
  const computedIndex = computedStep === 'dashboard' ? onboardingSteps.length : computedStepIndex
  // Once the user reaches the dashboard, ignore any override and never display an
  // onboarding step (arrows are onboarding-only).
  const overrideValid =
    computedStep !== 'dashboard' && overrideIndex !== -1 && overrideIndex < computedIndex
  const displayStep: StepId = overrideValid ? (viewStepOverride as StepId) : computedStep
  const displayIndex = overrideValid ? overrideIndex : computedIndex

  useEffect(() => {
    if (viewStepOverride && !overrideValid) {
      setViewStepOverride(null)
    }
  }, [viewStepOverride, overrideValid])

  // Back: allowed for any non-first onboarding step. The override only changes which
  // step's UI is rendered — it never mutates real state (granted permissions and saved
  // API keys are preserved), so there's no reason to lock the user out of revisiting.
  const canGoBack = displayIndex > 0 && displayStep !== 'dashboard'

  // Forward: enabled when the displayed step's continue would succeed.
  const canGoForward = ((): boolean => {
    if (displayStep === 'dashboard') return false
    switch (displayStep) {
      case 'welcome':
        return true
      case 'permissions':
        return permissionsResolved
      case 'plan':
      case 'activation':
        return isConfigured
      case 'connect':
      case 'blacklist':
      case 'capture':
        return true
      default:
        return false
    }
  })()

  const handleBack = useCallback(() => {
    if (displayIndex <= 0) return
    setViewStepOverride(onboardingSteps[displayIndex - 1].id)
  }, [displayIndex, onboardingSteps])

  const handleForward = useCallback(() => {
    // If the user is viewing an earlier step via override, just step the override forward.
    if (overrideValid && overrideIndex + 1 < computedIndex) {
      setViewStepOverride(onboardingSteps[overrideIndex + 1].id)
      return
    }
    // Otherwise we're at the leading edge — perform the step's continue
    // action. Every step except `activation` needs an explicit completion
    // mark so it doesn't re-appear on resume even when its underlying state
    // is also satisfied (`isStepComplete` requires both for those steps).
    // `activation` is gated purely on `isConfigured` and has no Continue.
    if (displayStep !== 'activation') {
      markStepCompleted(displayIndex)
    }
    setViewStepOverride(null)
  }, [
    overrideValid,
    overrideIndex,
    computedIndex,
    onboardingSteps,
    displayStep,
    displayIndex,
    markStepCompleted,
  ])

  useEffect(() => {
    void api.getStatus().then((status) => {
      setCapturing(status.capturing)
      setCaptureHotkeyLabel(status.captureHotkeyLabel)
    })
    api.onStatusChanged((status) => {
      setCapturing(status.capturing)
      setCaptureHotkeyLabel(status.captureHotkeyLabel)
      void loadStats()
      void loadPatterns()
    })
    void loadAll().then(() => {
      setInitialLoaded(true)
    })
  }, [api, loadAll, loadStats, loadPatterns])

  useEffect(() => {
    api.onSubscriptionUpdate(() => {
      void loadCredentials()
    })
  }, [api, loadCredentials])

  useEffect(() => {
    api.onAccessStateChanged((state) => {
      setAccessState(state)
      void loadCredentials()
    })
  }, [api, loadCredentials])

  useEffect(() => {
    const unsubscribe = api.onPermissionStatusChanged(updatePermissionStatus)
    return () => unsubscribe()
  }, [api, updatePermissionStatus])

  // Self-heal `lastCompletedStepIndex` from concrete state once everything
  // has loaded. If a returning user has already granted permissions, set a
  // key, or connected MCP, those steps are implicitly done — bump the mark
  // forward so they don't get re-walked through welcome / permissions / etc.
  useEffect(() => {
    if (!initialLoaded) return
    let implied = -1
    if (hasAnyProgress) implied = Math.max(implied, 0) // welcome
    if (permissionStatus !== null && accessibilityGranted && screenRecordingGranted) {
      const idx = onboardingSteps.findIndex((s) => s.id === 'permissions')
      if (idx !== -1) implied = Math.max(implied, idx)
    }
    if (isConfigured) {
      const planIdx = onboardingSteps.findIndex((s) => s.id === 'plan')
      const actIdx = onboardingSteps.findIndex((s) => s.id === 'activation')
      if (planIdx !== -1) implied = Math.max(implied, planIdx)
      if (actIdx !== -1) implied = Math.max(implied, actIdx)
    }
    if (anyMcpConnected) {
      const idx = onboardingSteps.findIndex((s) => s.id === 'connect')
      if (idx !== -1) implied = Math.max(implied, idx)
    }
    if (implied > lastCompletedStepIndex) {
      markStepCompleted(implied)
    }
  }, [
    initialLoaded,
    hasAnyProgress,
    isConfigured,
    permissionStatus,
    accessibilityGranted,
    screenRecordingGranted,
    anyMcpConnected,
    lastCompletedStepIndex,
    onboardingSteps,
    markStepCompleted,
  ])

  useEffect(() => {
    const handleFocus = (): void => {
      void loadAll()
      void api.getStatus().then((status) => {
        setCapturing(status.capturing)
        setCaptureHotkeyLabel(status.captureHotkeyLabel)
      })
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [api, loadAll])

  const handleToggle = useCallback(async () => {
    setToggling(true)
    try {
      const status = await api.toggleCapture()
      setCapturing(status.capturing)
      setCaptureHotkeyLabel(status.captureHotkeyLabel)
    } finally {
      setToggling(false)
    }
  }, [api])

  if (page === 'settings') {
    return (
      <div className="h-screen overflow-hidden antialiased select-none">
        <AdvancedSettingsPage
          onBack={() => {
            setPage('home')
            setSettingsInitialTab(undefined)
            void loadAll()
          }}
          initialTab={settingsInitialTab}
        />
        <Toaster />
      </div>
    )
  }

  return (
    <div className="min-h-screen antialiased select-none relative">
      {computedStep === 'dashboard' && (
        <div className="absolute top-3 right-3 z-10">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage('settings')}
            aria-label="Settings"
          >
            <Settings className="size-4" />
          </Button>
        </div>
      )}
      <div className="p-6 max-w-xl mx-auto space-y-5">
        {!initialLoaded ? null : displayStep === 'dashboard' ? (
          <>
            <StatusLine
              capturing={capturing}
              llmHealth={llmHealth}
              activityCount={stats?.activityCount ?? null}
            />

            <CaptureControlSection
              capturing={capturing}
              captureHotkeyLabel={captureHotkeyLabel}
              toggling={toggling}
              onToggle={() => void handleToggle()}
            />

            <PatternsSection
              api={api}
              patterns={patterns!}
              onPatternsChange={() => void loadPatterns()}
            />
          </>
        ) : (
          <OnboardingLayout
            steps={onboardingSteps}
            currentStep={displayStep as OnboardingStepId}
            onBack={handleBack}
            onForward={handleForward}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
          >
            {displayStep === 'welcome' ? (
              <WelcomeStep
                onContinue={() => {
                  markStepCompleted(onboardingSteps.findIndex((s) => s.id === 'welcome'))
                  setViewStepOverride(null)
                }}
              />
            ) : displayStep === 'permissions' ? (
              <PermissionsStep
                api={api}
                onContinue={() => {
                  markStepCompleted(onboardingSteps.findIndex((s) => s.id === 'permissions'))
                  setViewStepOverride(null)
                }}
              />
            ) : displayStep === 'plan' ? (
              <PlanPicker
                api={api}
                onKeySet={() => void loadCredentials()}
                onUseOwnEndpoint={() => {
                  setSettingsInitialTab('ai-models')
                  setPage('settings')
                }}
                isConfigured={isConfigured}
                onContinue={() => {
                  markStepCompleted(onboardingSteps.findIndex((s) => s.id === 'plan'))
                  setViewStepOverride(null)
                }}
              />
            ) : displayStep === 'activation' ? (
              <EnterpriseActivationCard api={api} accessState={accessState} />
            ) : displayStep === 'connect' ? (
              <ConnectStep
                api={api}
                mcpStatus={mcpStatus}
                onStatusChange={() => void loadMcpStatus()}
                onContinue={() => {
                  markStepCompleted(onboardingSteps.findIndex((s) => s.id === 'connect'))
                  setViewStepOverride(null)
                }}
              />
            ) : displayStep === 'blacklist' ? (
              <BlacklistStep
                api={api}
                onContinue={() => {
                  markStepCompleted(onboardingSteps.findIndex((s) => s.id === 'blacklist'))
                  setViewStepOverride(null)
                }}
              />
            ) : (
              <CaptureStep
                api={api}
                capturing={capturing}
                captureHotkeyLabel={captureHotkeyLabel}
                toggling={toggling}
                onToggle={() => void handleToggle()}
                activityCount={stats?.activityCount ?? null}
                onContinue={() => {
                  markStepCompleted(onboardingSteps.findIndex((s) => s.id === 'capture'))
                  setViewStepOverride(null)
                }}
              />
            )}
          </OnboardingLayout>
        )}
      </div>
      <Toaster />
    </div>
  )
}
