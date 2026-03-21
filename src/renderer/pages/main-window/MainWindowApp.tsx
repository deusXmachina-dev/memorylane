import { useCallback, useEffect, useState } from 'react'
import { Toaster } from '@components/ui/sonner'
import { toast } from 'sonner'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import { useLlmHealth } from '@/renderer/hooks/use-llm-health'
import { Logo } from './components/Logo'
import { PlanPicker } from './components/PlanPicker'
import { CaptureControlSection } from './components/CaptureControlSection'
import { ScreenRecordingSection } from './components/ScreenRecordingSection'
import { ConnectClaudeSection } from './components/ConnectClaudeSection'
import { StatusLine } from './components/StatusLine'
import { PatternsSection } from './components/PatternsSection'
import { AdvancedSettingsPage } from './AdvancedSettingsPage'
import type { CustomEndpointStatus, KeyStatus, MainWindowStats, MainWindowStatus } from '@types'

export function MainWindowApp(): React.JSX.Element {
  const api = useMainWindowAPI()
  const [page, setPage] = useState<'home' | 'settings'>('home')
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null)
  const [endpointStatus, setEndpointStatus] = useState<CustomEndpointStatus | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [captureHotkeyLabel, setCaptureHotkeyLabel] = useState('')
  const [toggling, setToggling] = useState(false)
  const [screenRecording, setScreenRecording] = useState(false)
  const [recordingBusy, setRecordingBusy] = useState(false)
  const [recordingsDirectory, setRecordingsDirectory] = useState<string | null>(null)
  const [stats, setStats] = useState<MainWindowStats | null>(null)
  const [initialLoaded, setInitialLoaded] = useState(false)

  const applyStatus = useCallback((status: MainWindowStatus) => {
    setCapturing(status.capturing)
    setCaptureHotkeyLabel(status.captureHotkeyLabel)
    setScreenRecording(status.screenRecording)
    setRecordingsDirectory(status.recordingsDirectory)
  }, [])

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
    await Promise.all([loadKeyStatus(), loadEndpointStatus(), loadStats()])
  }, [loadEndpointStatus, loadKeyStatus, loadStats])

  const hasKey = keyStatus?.hasKey ?? false
  const hasCustomEndpoint = endpointStatus?.enabled ?? false
  const isConfigured = hasKey || hasCustomEndpoint
  const { llmHealth } = useLlmHealth({
    api,
    enabled: page === 'home' && isConfigured,
  })

  useEffect(() => {
    void api.getStatus().then((status) => {
      applyStatus(status)
    })
    api.onStatusChanged((status) => {
      applyStatus(status)
      void loadStats()
    })
    void loadAll().then(() => setInitialLoaded(true))
  }, [api, applyStatus, loadAll, loadStats])

  useEffect(() => {
    api.onSubscriptionUpdate(() => {
      void loadKeyStatus()
    })
  }, [api, loadKeyStatus])

  useEffect(() => {
    const handleFocus = (): void => {
      void loadAll()
      void api.getStatus().then((status) => {
        applyStatus(status)
      })
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [api, applyStatus, loadAll])

  const handleToggle = useCallback(async () => {
    setToggling(true)
    try {
      const status = await api.toggleCapture()
      applyStatus(status)
    } finally {
      setToggling(false)
    }
  }, [api, applyStatus])

  const handleRecordingToggle = useCallback(async () => {
    setRecordingBusy(true)

    try {
      const status = screenRecording
        ? await api.stopScreenRecording()
        : await api.startScreenRecording()
      applyStatus(status)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Screen recording failed'
      toast.error(message)
    } finally {
      setRecordingBusy(false)
    }
  }, [api, applyStatus, screenRecording])

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

        <ScreenRecordingSection
          recording={screenRecording}
          busy={recordingBusy}
          recordingsDirectory={recordingsDirectory}
          onToggle={() => void handleRecordingToggle()}
        />

        {!initialLoaded ? null : !isConfigured ? (
          <PlanPicker api={api} onKeySet={() => void loadKeyStatus()} />
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
