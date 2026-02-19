import { useCallback, useEffect, useState } from 'react'
import { Toaster } from '@components/ui/sonner'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import { Logo } from './components/Logo'
import { ApiKeySetupSection } from './components/ApiKeySetupSection'
import { CaptureControlSection } from './components/CaptureControlSection'
import { StatsDisplay } from './components/StatsDisplay'
import { IntegrationsSection } from './components/IntegrationsSection'
import { Button } from '@components/ui/button'
import { CaptureSettingsPage } from './CaptureSettingsPage'
import type { CustomEndpointStatus, KeyStatus, MainWindowStats } from '@types'

export function MainWindowApp(): React.JSX.Element {
  const api = useMainWindowAPI()
  const [page, setPage] = useState<'home' | 'settings'>('home')
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null)
  const [endpointStatus, setEndpointStatus] = useState<CustomEndpointStatus | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [stats, setStats] = useState<MainWindowStats | null>(null)

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
  }, [loadKeyStatus, loadEndpointStatus, loadStats])

  useEffect(() => {
    void api.getStatus().then((status) => setCapturing(status.capturing))
    api.onStatusChanged((status) => {
      setCapturing(status.capturing)
      void loadStats()
    })
    void loadAll()
  }, [api, loadAll, loadStats])

  useEffect(() => {
    const handleFocus = (): void => {
      void loadAll()
      void api.getStatus().then((status) => setCapturing(status.capturing))
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [api, loadAll])

  const handleToggle = useCallback(async () => {
    setToggling(true)
    try {
      const status = await api.toggleCapture()
      setCapturing(status.capturing)
    } finally {
      setToggling(false)
    }
  }, [api])

  const hasKey = keyStatus?.hasKey ?? false
  const hasCustomEndpoint = endpointStatus?.enabled ?? false
  const isConfigured = hasKey || hasCustomEndpoint

  if (page === 'settings') {
    return (
      <div className="min-h-screen antialiased select-none">
        <CaptureSettingsPage
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
      <div className="p-6 max-w-xl mx-auto space-y-4">
        <Logo />

        {!isConfigured ? (
          <ApiKeySetupSection api={api} onKeySet={loadKeyStatus} />
        ) : (
          <>
            <CaptureControlSection
              capturing={capturing}
              toggling={toggling}
              onToggle={() => void handleToggle()}
            />

            <StatsDisplay
              stats={stats}
              keyStatus={keyStatus}
              isCustomEndpoint={hasCustomEndpoint}
            />

            <IntegrationsSection api={api} />
          </>
        )}

        <div className="pt-1 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setPage('settings')}>
            Advanced Settings
          </Button>
        </div>
      </div>
      <Toaster />
    </div>
  )
}
