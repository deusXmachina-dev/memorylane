import { useCallback, useEffect, useState } from 'react'
import { Toaster } from '@components/ui/sonner'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import { useLlmHealth } from '@/renderer/hooks/use-llm-health'
import { Logo } from './components/Logo'
import { EnterpriseActivationCard } from './components/EnterpriseActivationCard'
import { PlanPicker } from './components/PlanPicker'
import { CaptureControlSection } from './components/CaptureControlSection'
import { ConnectStep } from './components/ConnectStep'
import { CaptureStep } from './components/CaptureStep'
import { StatusLine } from './components/StatusLine'
import { PatternsSection } from './components/PatternsSection'
import { AdvancedSettingsPage } from './AdvancedSettingsPage'
import type { AppEditionConfig } from '@/shared/edition'
import type {
  AccessState,
  CustomEndpointStatus,
  KeyStatus,
  MainWindowStats,
  McpRegistrationStatus,
  PatternInfo,
} from '@types'

export function MainWindowApp(): React.JSX.Element {
  const api = useMainWindowAPI()
  const [page, setPage] = useState<'home' | 'settings'>('home')
  const [editionConfig, setEditionConfig] = useState<AppEditionConfig | null>(null)
  const [accessState, setAccessState] = useState<AccessState | null>(null)
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null)
  const [endpointStatus, setEndpointStatus] = useState<CustomEndpointStatus | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [captureHotkeyLabel, setCaptureHotkeyLabel] = useState('')
  const [toggling, setToggling] = useState(false)
  const [stats, setStats] = useState<MainWindowStats | null>(null)
  const [mcpStatus, setMcpStatus] = useState<McpRegistrationStatus | null>(null)
  const [patterns, setPatterns] = useState<PatternInfo[] | null>(null)
  const [initialLoaded, setInitialLoaded] = useState(false)
  const [connectStepDone, setConnectStepDone] = useState(false)

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

  const loadKeyStatus = useCallback(async () => {
    try {
      const status = await api.getKeyStatus()
      setKeyStatus(status)
    } catch {
      // Silently handle error - key status will remain null
    }
  }, [api])

  const loadEndpointStatus = useCallback(async () => {
    try {
      const status = await api.getCustomEndpoint()
      setEndpointStatus(status)
    } catch {
      // Silently handle error
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

  const loadAll = useCallback(async () => {
    await loadEditionConfig()
    await loadAccessState()
    await Promise.all([
      loadKeyStatus(),
      loadEndpointStatus(),
      loadStats(),
      loadMcpStatus(),
      loadPatterns(),
    ])
  }, [
    loadAccessState,
    loadEditionConfig,
    loadEndpointStatus,
    loadKeyStatus,
    loadStats,
    loadMcpStatus,
    loadPatterns,
  ])

  const isEnterprise = editionConfig?.edition === 'enterprise'
  const hasKey = keyStatus?.hasKey ?? false
  const hasCustomEndpoint = endpointStatus?.enabled ?? false
  const isConfigured = isEnterprise
    ? accessState?.isEnterpriseActivated === true && hasKey
    : hasKey || hasCustomEndpoint
  const { llmHealth } = useLlmHealth({
    api,
    enabled: page === 'home' && isConfigured,
  })

  const anyMcpConnected = mcpStatus !== null && Object.values(mcpStatus).some(Boolean)
  const hasPatterns = patterns !== null && patterns.length > 0
  const step =
    !anyMcpConnected || !connectStepDone ? 'connect' : !hasPatterns ? 'capture' : 'dashboard'

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
      void api.getMcpStatus().then((s) => {
        if (s !== null && Object.values(s).some(Boolean)) setConnectStepDone(true)
      })
    })
  }, [api, loadAll, loadStats, loadPatterns])

  useEffect(() => {
    api.onSubscriptionUpdate(() => {
      void loadKeyStatus()
    })
  }, [api, loadKeyStatus])

  useEffect(() => {
    api.onAccessStateChanged((state) => {
      setAccessState(state)
      void loadKeyStatus()
    })
  }, [api, loadKeyStatus])

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
            void loadAll()
          }}
        />
        <Toaster />
      </div>
    )
  }

  return (
    <div className="min-h-screen antialiased select-none">
      <div className="p-6 max-w-xl mx-auto space-y-5">
        <Logo onSettingsClick={() => setPage('settings')} />

        {!initialLoaded ? null : !isConfigured ? (
          isEnterprise ? (
            <EnterpriseActivationCard api={api} accessState={accessState} />
          ) : (
            <PlanPicker api={api} onKeySet={() => void loadKeyStatus()} />
          )
        ) : step === 'connect' ? (
          <ConnectStep
            api={api}
            mcpStatus={mcpStatus}
            onStatusChange={() => void loadMcpStatus()}
            onContinue={() => setConnectStepDone(true)}
          />
        ) : step === 'capture' ? (
          <CaptureStep
            api={api}
            capturing={capturing}
            captureHotkeyLabel={captureHotkeyLabel}
            toggling={toggling}
            onToggle={() => void handleToggle()}
            activityCount={stats?.activityCount ?? null}
          />
        ) : (
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
        )}
      </div>
      <Toaster />
    </div>
  )
}
