import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Settings } from 'lucide-react'
import { Toaster } from '@components/ui/sonner'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import { useLlmHealth } from '@/renderer/hooks/use-llm-health'
import { Button } from '@components/ui/button'
import { CaptureControlSection } from './components/CaptureControlSection'
import { StatusLine } from './components/StatusLine'
import { PatternsSection } from './components/PatternsSection'
import { AdvancedSettingsPage } from './AdvancedSettingsPage'
import { BlacklistStep } from './components/onboarding/BlacklistStep'
import { CaptureStep } from './components/onboarding/CaptureStep'
import { ConnectStep } from './components/onboarding/ConnectStep'
import { CustomerActivationStep } from './components/onboarding/CustomerActivationStep'
import { EnterpriseActivationStep } from './components/onboarding/EnterpriseActivationStep'
import { OnboardingLayout, type OnboardingStepId } from './components/onboarding/OnboardingLayout'
import { PermissionsStep } from './components/onboarding/PermissionsStep'
import { WelcomeStep } from './components/onboarding/WelcomeStep'
import {
  LAST_COMPLETED_STEP_INDEX_KEY,
  localStorageAdapter,
  readLastCompletedIndex,
  writeIntFlag,
} from './onboarding-storage'
import { impliedCompletedIndex, resolveOnboarding } from './onboarding-state'
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
    readLastCompletedIndex(localStorageAdapter),
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
    } catch (error) {
      console.warn('[MainWindowApp] Failed to load permission status:', error)
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

  const platform = api.platform
  const isMac = platform === 'darwin'
  const anyMcpConnected = mcpStatus !== null && Object.values(mcpStatus).some(Boolean)
  const screenRecordingGranted = permissionStatus?.screenRecording === 'granted'
  const accessibilityGranted = permissionStatus?.accessibility === 'granted'
  // On non-darwin, both permissions are hard-coded `granted`, so they aren't a
  // real "progress" signal — exclude them to avoid auto-completing Welcome for
  // a brand-new Windows user.
  const hasAnyProgress = isMac
    ? isConfigured || screenRecordingGranted || accessibilityGranted || anyMcpConnected
    : isConfigured || anyMcpConnected
  const hasExistingActivities = (stats?.activityCount ?? 0) > 0

  const resolution = useMemo(
    () =>
      resolveOnboarding({
        isEnterprise,
        isConfigured,
        lastCompletedStepIndex,
        permissionStatus,
        permissionRestartPending,
        hasAnyProgress,
        anyMcpConnected,
        viewStepOverride,
        platform,
        hasExistingActivities,
      }),
    [
      isEnterprise,
      isConfigured,
      lastCompletedStepIndex,
      permissionStatus,
      permissionRestartPending,
      hasAnyProgress,
      anyMcpConnected,
      viewStepOverride,
      platform,
      hasExistingActivities,
    ],
  )
  const {
    steps: onboardingSteps,
    displaySteps: onboardingDisplaySteps,
    computedStep,
    computedIndex,
    displayStep,
    displayIndex,
    overrideValid,
    canGoBack,
    canGoForward,
  } = resolution

  useEffect(() => {
    if (viewStepOverride && !overrideValid) {
      setViewStepOverride(null)
    }
  }, [viewStepOverride, overrideValid])

  const handleBack = useCallback(() => {
    // Navigate against the displayed (filtered) step list so platforms that
    // hide the Permissions step don't accidentally land on it via override.
    const displayedIdx = onboardingDisplaySteps.findIndex((s) => s.id === displayStep)
    if (displayedIdx <= 0) return
    setViewStepOverride(onboardingDisplaySteps[displayedIdx - 1].id)
  }, [displayStep, onboardingDisplaySteps])

  const handleForward = useCallback(() => {
    // If the user is viewing an earlier step via override, just step the
    // override forward through the displayed list.
    if (overrideValid) {
      const displayedIdx = onboardingDisplaySteps.findIndex((s) => s.id === displayStep)
      const next = onboardingDisplaySteps[displayedIdx + 1]
      const nextCanonicalIdx = next ? onboardingSteps.findIndex((s) => s.id === next.id) : -1
      if (next && nextCanonicalIdx < computedIndex) {
        setViewStepOverride(next.id)
        return
      }
    }
    // Otherwise we're at the leading edge — perform the step's continue
    // action. Every step except `activation` needs an explicit completion
    // mark so it doesn't re-appear on resume even when its underlying state
    // is also satisfied. `activation` is gated purely on `isConfigured`.
    if (displayStep !== 'activation') {
      markStepCompleted(displayIndex)
    }
    setViewStepOverride(null)
  }, [
    overrideValid,
    computedIndex,
    onboardingSteps,
    onboardingDisplaySteps,
    displayStep,
    displayIndex,
    markStepCompleted,
  ])

  useEffect(() => {
    void api.getStatus().then((status) => {
      setCapturing(status.capturing)
      setCaptureHotkeyLabel(status.captureHotkeyLabel)
    })
    const unsubscribe = api.onStatusChanged((status) => {
      setCapturing(status.capturing)
      setCaptureHotkeyLabel(status.captureHotkeyLabel)
      void loadStats()
      void loadPatterns()
    })
    void loadAll().then(() => {
      setInitialLoaded(true)
    })
    return () => unsubscribe()
  }, [api, loadAll, loadStats, loadPatterns])

  useEffect(() => {
    const unsubscribe = api.onSubscriptionUpdate(() => {
      void loadCredentials()
    })
    return () => unsubscribe()
  }, [api, loadCredentials])

  useEffect(() => {
    const unsubscribe = api.onAccessStateChanged((state) => {
      setAccessState(state)
      void loadCredentials()
    })
    return () => unsubscribe()
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
    const implied = impliedCompletedIndex({
      isEnterprise,
      isConfigured,
      lastCompletedStepIndex,
      permissionStatus,
      permissionRestartPending,
      hasAnyProgress,
      anyMcpConnected,
      viewStepOverride: null,
      platform,
      hasExistingActivities,
    })
    if (implied > lastCompletedStepIndex) {
      markStepCompleted(implied)
    }
  }, [
    initialLoaded,
    isEnterprise,
    isConfigured,
    permissionStatus,
    permissionRestartPending,
    hasAnyProgress,
    anyMcpConnected,
    lastCompletedStepIndex,
    platform,
    hasExistingActivities,
    markStepCompleted,
  ])

  const refreshOnFocus = useCallback(async () => {
    // Edition config is build-time and never changes; skip it on focus refreshes.
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
    loadCredentials,
    loadStats,
    loadMcpStatus,
    loadPatterns,
    loadPermissionStatus,
  ])

  useEffect(() => {
    const handleFocus = (): void => {
      void refreshOnFocus()
      void api.getStatus().then((status) => {
        setCapturing(status.capturing)
        setCaptureHotkeyLabel(status.captureHotkeyLabel)
      })
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [api, refreshOnFocus])

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

  const advance = useCallback(
    (id: OnboardingStepId) => () => {
      markStepCompleted(onboardingSteps.findIndex((s) => s.id === id))
      setViewStepOverride(null)
    },
    [markStepCompleted, onboardingSteps],
  )

  const renderStep = (id: OnboardingStepId): React.JSX.Element => {
    switch (id) {
      case 'welcome':
        return <WelcomeStep onContinue={advance('welcome')} />
      case 'permissions':
        return permissionStatus === null ? (
          <p className="text-sm text-muted-foreground">Checking permissions…</p>
        ) : (
          <PermissionsStep
            api={api}
            status={permissionStatus}
            needsRestart={permissionRestartPending}
            onContinue={advance('permissions')}
          />
        )
      case 'plan':
        return (
          <CustomerActivationStep
            api={api}
            onKeySet={() => void loadCredentials()}
            onUseOwnEndpoint={() => {
              setSettingsInitialTab('ai-models')
              setPage('settings')
            }}
            isConfigured={isConfigured}
            onContinue={advance('plan')}
          />
        )
      case 'activation':
        return <EnterpriseActivationStep api={api} accessState={accessState} />
      case 'connect':
        return (
          <ConnectStep
            api={api}
            mcpStatus={mcpStatus}
            onStatusChange={() => void loadMcpStatus()}
            onContinue={advance('connect')}
          />
        )
      case 'blacklist':
        return <BlacklistStep api={api} onContinue={advance('blacklist')} />
      case 'capture':
        return (
          <CaptureStep
            api={api}
            capturing={capturing}
            captureHotkeyLabel={captureHotkeyLabel}
            toggling={toggling}
            onToggle={() => void handleToggle()}
            activityCount={stats?.activityCount ?? null}
            onContinue={advance('capture')}
          />
        )
    }
  }

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
            steps={onboardingDisplaySteps}
            currentStep={displayStep as OnboardingStepId}
            onBack={handleBack}
            onForward={handleForward}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
          >
            {renderStep(displayStep as OnboardingStepId)}
          </OnboardingLayout>
        )}
      </div>
      <Toaster />
    </div>
  )
}
