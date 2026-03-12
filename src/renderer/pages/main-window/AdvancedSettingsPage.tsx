import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import type {
  CaptureSettings,
  CustomEndpointStatus,
  KeyStatus,
  SemanticPipelineMode,
  SlackIntegrationStatus,
} from '@types'
import { AiModelsSection } from './components/advanced-settings/AiModelsSection'
import { CapturePrivacySection } from './components/advanced-settings/CapturePrivacySection'
import { ConnectionsDataSection } from './components/advanced-settings/ConnectionsDataSection'
import type { NumericCaptureSetting } from './components/advanced-settings/types'
import { detectHotkeyPlatform, toRecordedAccelerator } from './hotkey-utils'

export function AdvancedSettingsPage({ onBack }: { onBack: () => void }): React.JSX.Element {
  const api = useMainWindowAPI()
  const hotkeyPlatform = useMemo(() => detectHotkeyPlatform(), [])
  const [form, setForm] = useState<CaptureSettings | null>(null)
  const [endpointStatus, setEndpointStatus] = useState<CustomEndpointStatus | null>(null)
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null)
  const [, setSlackStatus] = useState<SlackIntegrationStatus | null>(null)
  const [aiModelsOpen, setAiModelsOpen] = useState(false)
  const [capturePrivacyOpen, setCapturePrivacyOpen] = useState(false)
  const [connectionsDataOpen, setConnectionsDataOpen] = useState(false)
  const [recordingHotkey, setRecordingHotkey] = useState(false)

  const load = useCallback(async () => {
    const [s, ep, ks, slack] = await Promise.all([
      api.getCaptureSettings(),
      api.getCustomEndpoint(),
      api.getKeyStatus(),
      api.getSlackSettings(),
    ])
    setForm(s)
    setEndpointStatus(ep)
    setKeyStatus(ks)
    setSlackStatus(slack)
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(
    (settings: Partial<CaptureSettings>, successMessage = 'Settings saved') => {
      void api.saveCaptureSettings(settings).then((result) => {
        if (!result.success) {
          toast.error(result.error ?? 'Failed to save settings', {
            id: 'auto-save-error',
            duration: 3000,
          })
          return
        }

        toast.success(successMessage, { id: 'auto-save', duration: 1500 })
      })
    },
    [api],
  )

  const setNumericSetting = useCallback((key: NumericCaptureSetting, value: number): void => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }, [])

  const commitNumericSetting = useCallback(
    (key: NumericCaptureSetting, value: number): void => {
      setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
      save({ [key]: value } as Pick<CaptureSettings, NumericCaptureSetting>)
    },
    [save],
  )

  const setSemanticPipelineMode = useCallback(
    (mode: SemanticPipelineMode): void => {
      setForm((prev) => (prev ? { ...prev, semanticPipelineMode: mode } : prev))
      save({ semanticPipelineMode: mode })
    },
    [save],
  )

  const setAutoStartEnabled = useCallback(
    (enabled: boolean): void => {
      setForm((prev) => (prev ? { ...prev, autoStartEnabled: enabled } : prev))
      save(
        { autoStartEnabled: enabled },
        enabled ? 'Launch at login enabled' : 'Launch at login disabled',
      )
    },
    [save],
  )

  const commitModelChange = useCallback(
    (
      key: 'semanticVideoModel' | 'semanticSnapshotModel' | 'patternDetectionModel',
      value: string,
    ): void => {
      setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
      save({ [key]: value }, 'Model updated')
    },
    [save],
  )

  const commitExcludedRules = useCallback(
    (rules: {
      excludedApps: string[]
      excludedWindowTitlePatterns: string[]
      excludedUrlPatterns: string[]
    }): void => {
      setForm((prev) =>
        prev
          ? {
              ...prev,
              excludedApps: rules.excludedApps,
              excludedWindowTitlePatterns: rules.excludedWindowTitlePatterns,
              excludedUrlPatterns: rules.excludedUrlPatterns,
            }
          : prev,
      )
      save(
        {
          excludedApps: rules.excludedApps,
          excludedWindowTitlePatterns: rules.excludedWindowTitlePatterns,
          excludedUrlPatterns: rules.excludedUrlPatterns,
        },
        'Privacy rules updated',
      )
    },
    [save],
  )

  const commitExcludePrivateBrowsing = useCallback(
    (enabled: boolean): void => {
      setForm((prev) => (prev ? { ...prev, excludePrivateBrowsing: enabled } : prev))
      save(
        { excludePrivateBrowsing: enabled },
        enabled ? 'Private browsing exclusion enabled' : 'Private browsing exclusion disabled',
      )
    },
    [save],
  )

  const setCaptureHotkeyAccelerator = useCallback((value: string): void => {
    setForm((prev) => (prev ? { ...prev, captureHotkeyAccelerator: value } : prev))
  }, [])

  const commitDatabaseExportDirectory = useCallback(
    (databaseExportDirectory: string): void => {
      setForm((prev) => (prev ? { ...prev, databaseExportDirectory } : prev))
      save(
        { databaseExportDirectory },
        databaseExportDirectory ? 'Raw DB export folder saved' : 'Raw DB export disabled',
      )
    },
    [save],
  )

  const refreshKeyStatus = useCallback(async (): Promise<void> => {
    const status = await api.getKeyStatus()
    setKeyStatus(status)
  }, [api])

  const refreshEndpointStatus = useCallback(async (): Promise<void> => {
    const status = await api.getCustomEndpoint()
    setEndpointStatus(status)
  }, [api])

  const handleReset = useCallback(async (): Promise<void> => {
    await api.resetCaptureSettings()
    await load()
  }, [api, load])

  useEffect(() => {
    if (!recordingHotkey) return

    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        setRecordingHotkey(false)
        return
      }

      const accelerator = toRecordedAccelerator(event)
      if (!accelerator) return

      setCaptureHotkeyAccelerator(accelerator)
      setRecordingHotkey(false)
      void api
        .saveCaptureSettings({ captureHotkeyAccelerator: accelerator })
        .then(async (result) => {
          if (!result.success) {
            toast.error(result.error ?? 'Failed to save settings', {
              id: 'auto-save-error',
              duration: 3000,
            })
            await load()
            return
          }

          toast.success('Start/stop shortcut saved', { id: 'auto-save', duration: 1500 })
          await load()
        })
        .catch(async () => {
          toast.error('Failed to save settings', { id: 'auto-save-error', duration: 3000 })
          await load()
        })
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [api, load, recordingHotkey, setCaptureHotkeyAccelerator])

  return (
    <div className="p-6 max-w-xl mx-auto space-y-4 overflow-y-auto max-h-screen">
      <button
        onClick={onBack}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        &larr; Back
      </button>

      {form && (
        <>
          <CapturePrivacySection
            open={capturePrivacyOpen}
            onToggle={() => setCapturePrivacyOpen((v) => !v)}
            form={form}
            hotkeyPlatform={hotkeyPlatform}
            recordingHotkey={recordingHotkey}
            onToggleRecordingHotkey={() => setRecordingHotkey((current) => !current)}
            onAutoStartEnabledChange={setAutoStartEnabled}
            onSettingChange={setNumericSetting}
            onSettingCommit={commitNumericSetting}
            onExcludePrivateBrowsingChange={commitExcludePrivateBrowsing}
            onExcludedRulesCommit={commitExcludedRules}
            onReset={() => void handleReset()}
          />

          <div className="border-t border-border" />

          <AiModelsSection
            api={api}
            open={aiModelsOpen}
            onToggle={() => setAiModelsOpen((v) => !v)}
            form={form}
            keyStatus={keyStatus}
            endpointStatus={endpointStatus}
            onKeyStatusChanged={() => void refreshKeyStatus()}
            onEndpointStatusChanged={() => void refreshEndpointStatus()}
            onSemanticPipelineModeChange={setSemanticPipelineMode}
            onSettingChange={setNumericSetting}
            onSettingCommit={commitNumericSetting}
            onModelChange={commitModelChange}
          />

          <div className="border-t border-border" />

          <ConnectionsDataSection
            api={api}
            open={connectionsDataOpen}
            onToggle={() => setConnectionsDataOpen((v) => !v)}
            databaseExportDirectory={form.databaseExportDirectory}
            onDatabaseExportDirectoryChange={commitDatabaseExportDirectory}
          />
        </>
      )}
    </div>
  )
}
