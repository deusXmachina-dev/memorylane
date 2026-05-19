import { useCallback, useEffect, useState } from 'react'
import { Toaster } from '@components/ui/sonner'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import { useLlmHealth } from '@/renderer/hooks/use-llm-health'
import { Button } from '@components/ui/button'
import { EnterpriseActivationCard } from './components/EnterpriseActivationCard'
import { PlanPicker } from './components/PlanPicker'
import { CaptureControlSection } from './components/CaptureControlSection'
import { ConnectStep } from './components/ConnectStep'
import { CaptureStep } from './components/CaptureStep'
import { StatusLine } from './components/StatusLine'
import { PatternsSection } from './components/PatternsSection'
import { AdvancedSettingsPage } from './AdvancedSettingsPage'
import { OnboardingLayout, type OnboardingStepInfo } from './components/OnboardingLayout'
import { WelcomeStep } from './components/WelcomeStep'
import { PermissionsStep } from './components/PermissionsStep'
import type { AppEditionConfig } from '@/shared/edition'
import type {
  AccessState,
  CaptureSettings,
  MainWindowStats,
  McpRegistrationStatus,
  PatternInfo,
  PermissionStatus,
  Vendor,
  VendorStatus,
} from '@types'

const WELCOME_SEEN_KEY = 'memorylane:onboarding:welcomeSeen'
const CONNECT_STEP_DONE_KEY = 'memorylane:onboarding:connectStepDone'
const CAPTURE_STEP_DONE_KEY = 'memorylane:onboarding:captureStepDone'

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    if (value) window.localStorage.setItem(key, '1')
    else window.localStorage.removeItem(key)
  } catch {
    // best-effort
  }
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
  const [connectStepDone, setConnectStepDone] = useState<boolean>(() =>
    readFlag(CONNECT_STEP_DONE_KEY),
  )
  const [captureStepDone, setCaptureStepDone] = useState<boolean>(() =>
    readFlag(CAPTURE_STEP_DONE_KEY),
  )
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus | null>(null)
  const [welcomeSeen, setWelcomeSeen] = useState<boolean>(() => readFlag(WELCOME_SEEN_KEY))

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
      setPermissionStatus(await api.getPermissionStatus())
    } catch {
      // Silently handle error
    }
  }, [api])

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

  const permissionsResolved =
    permissionStatus === null
      ? true // until we know, don't gate — avoids a flicker through the permissions step
      : permissionStatus.accessibility === 'granted' &&
        permissionStatus.screenRecording === 'granted'

  type StepId =
    | 'welcome'
    | 'permissions'
    | 'plan'
    | 'activation'
    | 'connect'
    | 'capture'
    | 'dashboard'
  const step: StepId = !welcomeSeen
    ? 'welcome'
    : !permissionsResolved
      ? 'permissions'
      : !isConfigured
        ? isEnterprise
          ? 'activation'
          : 'plan'
        : !isEnterprise && !connectStepDone
          ? 'connect'
          : !captureStepDone
            ? 'capture'
            : 'dashboard'

  const onboardingSteps: OnboardingStepInfo[] = isEnterprise
    ? [
        { id: 'welcome', label: 'Welcome' },
        { id: 'permissions', label: 'Permissions' },
        { id: 'activation', label: 'Activate' },
        { id: 'capture', label: 'Capture' },
      ]
    : [
        { id: 'welcome', label: 'Welcome' },
        { id: 'permissions', label: 'Permissions' },
        { id: 'plan', label: 'Plan' },
        { id: 'connect', label: 'Connect' },
        { id: 'capture', label: 'Capture' },
      ]

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
    const unsubscribe = api.onPermissionStatusChanged((status) => {
      setPermissionStatus(status)
    })
    return () => unsubscribe()
  }, [api])

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
      {step === 'dashboard' && (
        <div className="absolute top-3 right-3 z-10">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage('settings')}
            aria-label="Settings"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </Button>
        </div>
      )}
      <div className="p-6 max-w-xl mx-auto space-y-5">
        {!initialLoaded ? null : step === 'dashboard' ? (
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
          <OnboardingLayout steps={onboardingSteps} currentStep={step}>
            {step === 'welcome' ? (
              <WelcomeStep
                onContinue={() => {
                  writeFlag(WELCOME_SEEN_KEY, true)
                  setWelcomeSeen(true)
                }}
              />
            ) : step === 'permissions' ? (
              <PermissionsStep api={api} onAllGranted={() => void loadPermissionStatus()} />
            ) : step === 'plan' ? (
              <PlanPicker
                api={api}
                onKeySet={() => void loadCredentials()}
                onUseOwnEndpoint={() => {
                  setSettingsInitialTab('ai-models')
                  setPage('settings')
                }}
              />
            ) : step === 'activation' ? (
              <EnterpriseActivationCard api={api} accessState={accessState} />
            ) : step === 'connect' ? (
              <ConnectStep
                api={api}
                mcpStatus={mcpStatus}
                onStatusChange={() => void loadMcpStatus()}
                onContinue={() => {
                  writeFlag(CONNECT_STEP_DONE_KEY, true)
                  setConnectStepDone(true)
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
                  writeFlag(CAPTURE_STEP_DONE_KEY, true)
                  setCaptureStepDone(true)
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
