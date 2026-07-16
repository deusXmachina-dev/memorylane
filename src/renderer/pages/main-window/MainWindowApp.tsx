import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Toaster } from '@components/ui/sonner'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import { useLlmHealth } from '@/renderer/hooks/use-llm-health'
import { useActivitiesData } from '@/renderer/hooks/use-activities-data'
import { MainShell } from './components/shell/MainShell'
import { Sidebar, type MainSection } from './components/shell/Sidebar'
import { ActivitiesPage } from './pages/ActivitiesPage'
import { PatternsPage } from './pages/PatternsPage'
import { SettingsPage, type SettingsTab } from './pages/SettingsPage'
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
  readIntFlag,
  readLastCompletedIndex,
  writeIntFlag,
} from './onboarding-storage'
import {
  impliedCompletedIndex,
  nextOverrideDisplayStep,
  previousDisplayStep,
  resolveOnboarding,
} from './onboarding-state'
import type { AppEditionConfig } from '@/shared/edition'
import type {
  AccessState,
  CaptureSettings,
  MainWindowStats,
  McpRegistrationStatus,
  ClustersView,
  MiningStatus,
  PatternInfo,
  PermissionState,
  PermissionStatus,
  UpdateInfo,
  Vendor,
  VendorStatus,
} from '@types'

const SIDEBAR_COLLAPSED_KEY = 'memorylane:sidebar:collapsed'

export function MainWindowApp(): React.JSX.Element {
  const api = useMainWindowAPI()
  const [section, setSection] = useState<MainSection>('activities')
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => readIntFlag(localStorageAdapter, SIDEBAR_COLLAPSED_KEY, 0) === 1,
  )
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab | undefined>(undefined)
  const [editionConfig, setEditionConfig] = useState<AppEditionConfig | null>(null)
  const [accessState, setAccessState] = useState<AccessState | null>(null)
  const [credentialStatuses, setCredentialStatuses] = useState<Record<Vendor, VendorStatus> | null>(
    null,
  )
  const [activeVendor, setActiveVendor] = useState<Vendor>('openrouter')
  const [capturing, setCapturing] = useState(false)
  const [pausedUntilMs, setPausedUntilMs] = useState<number | null>(null)
  const [toggling, setToggling] = useState(false)
  const [stats, setStats] = useState<MainWindowStats | null>(null)
  const [mcpStatus, setMcpStatus] = useState<McpRegistrationStatus | null>(null)
  const [clusters, setClusters] = useState<ClustersView | null>(null)
  const [patterns, setPatterns] = useState<PatternInfo[] | null>(null)
  const [miningStatus, setMiningStatus] = useState<MiningStatus | null>(null)
  // Developer toggle read once at startup. Off (default) → legacy PatternDetector
  // + patterns view; on → new TaskMiner + clusters view. Takes effect on restart.
  const [newTaskMinerEnabled, setNewTaskMinerEnabled] = useState(false)
  const [initialLoaded, setInitialLoaded] = useState(false)
  const [lastCompletedStepIndex, setLastCompletedStepIndex] = useState<number>(() =>
    readLastCompletedIndex(localStorageAdapter),
  )
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus | null>(null)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
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

  // Loader errors are surfaced indirectly via UI state (null fields, empty
  // lists). The renderer recovers on the next focus / event refresh.
  const loadEditionConfig = useCallback(async () => {
    try {
      setEditionConfig(await api.getEditionConfig())
    } catch {
      /* ignored */
    }
  }, [api])

  const loadAccessState = useCallback(async () => {
    try {
      setAccessState(await api.refreshAccessState())
    } catch {
      /* ignored */
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
      setNewTaskMinerEnabled(settings.newTaskMinerEnabled)
    } catch {
      /* ignored */
    }
  }, [api])

  const loadStats = useCallback(async () => {
    try {
      setStats(await api.getStats())
    } catch {
      /* ignored */
    }
  }, [api])

  const loadMcpStatus = useCallback(async () => {
    try {
      setMcpStatus(await api.getMcpStatus())
    } catch {
      /* ignored */
    }
  }, [api])

  const loadClusters = useCallback(async () => {
    try {
      setClusters(await api.getClusters())
    } catch {
      setClusters({ clusters: [], hiddenCount: 0 })
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
      loadClusters(),
      loadPatterns(),
      loadPermissionStatus(),
    ])
  }, [
    loadAccessState,
    loadEditionConfig,
    loadCredentials,
    loadStats,
    loadMcpStatus,
    loadClusters,
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
    enabled: isConfigured,
  })
  const activities = useActivitiesData(api)
  const activitiesRefreshRef = useRef(activities.refresh)
  activitiesRefreshRef.current = activities.refresh

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
  const hasExistingActivities = (stats?.activityCount ?? 0) > 0
  // On non-darwin, both permissions are hard-coded `granted`, so they aren't a
  // real "progress" signal — exclude them to avoid auto-completing Welcome for
  // a brand-new Windows user. Existing DB activity counts as progress on every
  // platform so wipe-localStorage users land straight on dashboard instead of
  // flashing through Welcome before the self-heal effect bumps the index.
  const hasAnyProgress = isMac
    ? isConfigured ||
      screenRecordingGranted ||
      accessibilityGranted ||
      anyMcpConnected ||
      hasExistingActivities
    : isConfigured || anyMcpConnected || hasExistingActivities

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
    const prev = previousDisplayStep(displayStep, onboardingDisplaySteps)
    if (prev === null) return
    setViewStepOverride(prev)
  }, [displayStep, onboardingDisplaySteps])

  const handleForward = useCallback(() => {
    // If the user is viewing an earlier step via override, just step the
    // override forward through the displayed list.
    if (overrideValid) {
      const next = nextOverrideDisplayStep(
        displayStep,
        onboardingDisplaySteps,
        onboardingSteps,
        computedIndex,
      )
      if (next !== null) {
        setViewStepOverride(next)
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
      setPausedUntilMs(status.pausedUntilMs)
    })
    const unsubscribe = api.onStatusChanged((status) => {
      setCapturing(status.capturing)
      setPausedUntilMs(status.pausedUntilMs)
      void loadStats()
      void loadClusters()
      void loadPatterns()
      void activitiesRefreshRef.current()
    })
    void loadAll().then(() => {
      setInitialLoaded(true)
    })
    return () => unsubscribe()
  }, [api, loadAll, loadStats, loadClusters, loadPatterns])

  useEffect(() => {
    void api.getMiningStatus().then(setMiningStatus)
    const unsubscribe = api.onMiningProgressChanged((status) => {
      setMiningStatus(status)
      // Each finished day can add or grow clusters — keep the view fresh.
      void loadClusters()
    })
    return () => unsubscribe()
  }, [api, loadClusters])

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

  useEffect(() => {
    void api.getUpdateInfo().then(setUpdateInfo)
    const unsubscribe = api.onUpdateStateChanged(setUpdateInfo)
    return () => unsubscribe()
  }, [api])

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
      loadClusters(),
      loadPatterns(),
      loadPermissionStatus(),
      activitiesRefreshRef.current(),
    ])
  }, [
    loadAccessState,
    loadCredentials,
    loadStats,
    loadMcpStatus,
    loadClusters,
    loadPatterns,
    loadPermissionStatus,
  ])

  useEffect(() => {
    const handleFocus = (): void => {
      void refreshOnFocus()
      void api.getStatus().then((status) => {
        setCapturing(status.capturing)
        setPausedUntilMs(status.pausedUntilMs)
      })
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [api, refreshOnFocus])

  const applyStatus = useCallback(
    (status: { capturing: boolean; pausedUntilMs: number | null }) => {
      setCapturing(status.capturing)
      setPausedUntilMs(status.pausedUntilMs)
    },
    [],
  )

  // Run a capture-control IPC call with the `toggling` busy flag and apply the
  // returned status. Shared by toggle/pause/resume — they differ only in call.
  const runStatusAction = useCallback(
    async (action: () => Promise<{ capturing: boolean; pausedUntilMs: number | null }>) => {
      setToggling(true)
      try {
        applyStatus(await action())
      } finally {
        setToggling(false)
      }
    },
    [applyStatus],
  )

  const handleToggle = useCallback(() => runStatusAction(api.toggleCapture), [api, runStatusAction])
  const handlePause = useCallback(
    (durationMs: number) => runStatusAction(() => api.pauseCapture(durationMs)),
    [api, runStatusAction],
  )
  const handleResume = useCallback(() => runStatusAction(api.resumeCapture), [api, runStatusAction])

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
              setSection('settings')
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
            toggling={toggling}
            onToggle={() => void handleToggle()}
            activityCount={stats?.activityCount ?? null}
            onContinue={advance('capture')}
          />
        )
    }
  }

  const onSelectSection = useCallback((next: MainSection) => {
    setSection(next)
    if (next !== 'settings') setSettingsInitialTab(undefined)
  }, [])

  const handleOpenLlmSettings = useCallback(() => {
    // Enterprise hides the AI Models tab — fall back to Data so the click still lands somewhere useful.
    setSettingsInitialTab(isEnterprise ? 'data' : 'ai-models')
    setSection('settings')
  }, [isEnterprise])

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      writeIntFlag(localStorageAdapter, SIDEBAR_COLLAPSED_KEY, next ? 1 : 0)
      return next
    })
  }, [])

  // Until initial load completes we can't tell whether to show onboarding or
  // the shell — render nothing rather than flashing the shell first.
  if (!initialLoaded) {
    return <Toaster />
  }

  // Onboarding takes over the full window — no shell. Exception: the
  // CustomerActivation step's "use your own endpoint" escape hatch pushes
  // section='settings' so the user can enter their key; surface the shell in
  // that case so they can navigate. Returning to any other section flips
  // back into the onboarding takeover.
  if (computedStep !== 'dashboard' && section !== 'settings') {
    return (
      <div className="min-h-screen antialiased select-none">
        <div className="p-6 max-w-xl mx-auto space-y-5">
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
        </div>
        <Toaster />
      </div>
    )
  }

  const sidebar = (
    <Sidebar
      section={section}
      onSelectSection={onSelectSection}
      capturing={capturing}
      toggling={toggling}
      onToggleCapture={() => void handleToggle()}
      pausedUntilMs={pausedUntilMs}
      onPauseCapture={(durationMs) => void handlePause(durationMs)}
      onResumeCapture={() => void handleResume()}
      vendor={activeVendor}
      llmHealth={llmHealth}
      configured={isConfigured}
      onOpenLlmSettings={handleOpenLlmSettings}
      updateReady={updateInfo?.state === 'ready'}
      updateVersion={updateInfo?.version ?? null}
      onInstallUpdate={() => void api.installUpdate()}
      collapsed={sidebarCollapsed}
      onToggleCollapsed={handleToggleSidebar}
    />
  )

  const renderSection = (): React.JSX.Element => {
    switch (section) {
      case 'activities':
        return (
          <ActivitiesPage
            activities={activities}
            onOpenPrivacy={() => {
              setSettingsInitialTab('privacy')
              setSection('settings')
            }}
          />
        )
      case 'patterns':
        return (
          <PatternsPage
            api={api}
            newTaskMinerEnabled={newTaskMinerEnabled}
            clusters={clusters}
            patterns={patterns}
            miningStatus={miningStatus}
            onPatternsChange={() => void loadPatterns()}
          />
        )
      case 'settings':
        return (
          <SettingsPage
            initialTab={settingsInitialTab}
            onCredentialsChanged={() => void loadCredentials()}
            onBack={
              computedStep !== 'dashboard'
                ? () => {
                    setSection('activities')
                    setSettingsInitialTab(undefined)
                  }
                : undefined
            }
          />
        )
    }
  }
  return (
    <>
      <MainShell sidebar={sidebar} sidebarCollapsed={sidebarCollapsed}>
        {renderSection()}
      </MainShell>
      <Toaster />
    </>
  )
}
