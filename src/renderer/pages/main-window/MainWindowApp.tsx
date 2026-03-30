import { useCallback, useEffect, useState } from 'react'
import { Toaster } from '@components/ui/sonner'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import { useLlmHealth } from '@/renderer/hooks/use-llm-health'
import { Logo } from './components/Logo'
import { EnterpriseActivationCard } from './components/EnterpriseActivationCard'
import { PlanPicker } from './components/PlanPicker'
import { CaptureControlSection } from './components/CaptureControlSection'
import { ConnectClaudeSection } from './components/ConnectClaudeSection'
import { StatusLine } from './components/StatusLine'
import { PatternsSection } from './components/PatternsSection'
import { AdvancedSettingsPage } from './AdvancedSettingsPage'
import type { AppEditionConfig } from '@/shared/edition'
import type { AccessState, CustomEndpointStatus, KeyStatus, MainWindowStats } from '@types'

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
  const [initialLoaded, setInitialLoaded] = useState(false)

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

  const loadAll = useCallback(async () => {
    await loadEditionConfig()
    await loadAccessState()
    await Promise.all([loadKeyStatus(), loadEndpointStatus(), loadStats()])
  }, [loadAccessState, loadEditionConfig, loadEndpointStatus, loadKeyStatus, loadStats])

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

  useEffect(() => {
    void api.getStatus().then((status) => {
      setCapturing(status.capturing)
      setCaptureHotkeyLabel(status.captureHotkeyLabel)
    })
    api.onStatusChanged((status) => {
      setCapturing(status.capturing)
      setCaptureHotkeyLabel(status.captureHotkeyLabel)
      void loadStats()
    })
    void loadAll().then(() => setInitialLoaded(true))
  }, [api, loadAll, loadStats])

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
        ) : (
          <>
            <ConnectClaudeSection api={api} />

            <div className="space-y-2">
              <CaptureControlSection
                capturing={capturing}
                captureHotkeyLabel={captureHotkeyLabel}
                toggling={toggling}
                onToggle={() => void handleToggle()}
              />
              <StatusLine llmHealth={llmHealth} activityCount={stats?.activityCount ?? null} />
            </div>

            <hr className="border-border" />

            <PatternsSection api={api} />
          </>
        )}
      </div>
      <Toaster />
    </div>
  )
}
