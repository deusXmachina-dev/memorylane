import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@components/ui/tabs'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import type { AppEditionConfig } from '@/shared/edition'
import type { CaptureSettings, SemanticPipelineMode, Vendor, VendorStatus } from '@types'
import { AiModelsSection } from '../components/advanced-settings/AiModelsSection'
import { CapturePrivacySection } from '../components/advanced-settings/CapturePrivacySection'
import { DataTabPanel } from '../components/advanced-settings/DataTabPanel'
import { DeveloperSection } from '../components/advanced-settings/DeveloperSection'
import { IntegrationsTabPanel } from '../components/advanced-settings/IntegrationsTabPanel'
import type { NumericCaptureSetting } from '../components/advanced-settings/types'
import { PageLayout } from '../components/shell/PageLayout'
import { detectHotkeyPlatform, toRecordedAccelerator } from '../hotkey-utils'
import { setDevMode, useDevMode, useTapUnlock } from '@/renderer/lib/dev-mode'

export type SettingsTab = 'privacy' | 'data' | 'ai-models' | 'integrations' | 'developer'

export function SettingsPage({
  initialTab,
  onBack,
  onCredentialsChanged,
}: {
  initialTab?: SettingsTab
  onBack?: () => void
  onCredentialsChanged?: () => void
}): React.JSX.Element {
  const api = useMainWindowAPI()
  const hotkeyPlatform = useMemo(() => detectHotkeyPlatform(), [])
  const [editionConfig, setEditionConfig] = useState<AppEditionConfig | null>(null)
  const [form, setForm] = useState<CaptureSettings | null>(null)
  const [credentialStatuses, setCredentialStatuses] = useState<Record<Vendor, VendorStatus> | null>(
    null,
  )
  const [recordingHotkey, setRecordingHotkey] = useState(false)

  const load = useCallback(async () => {
    const [config, captureSettings, statuses] = await Promise.all([
      api.getEditionConfig(),
      api.getCaptureSettings(),
      api.getCredentialStatuses(),
    ])
    setEditionConfig(config)
    setForm(captureSettings)
    setCredentialStatuses(statuses)
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

  const setPatternDetectionEnabled = useCallback(
    (enabled: boolean): void => {
      setForm((prev) => (prev ? { ...prev, patternDetectionEnabled: enabled } : prev))
      save(
        { patternDetectionEnabled: enabled },
        enabled ? 'Automation opportunities enabled' : 'Automation opportunities disabled',
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

  const setUploadDetailLevel = useCallback(
    (level: 'off' | 'summary' | 'detailed'): void => {
      setForm((prev) => (prev ? { ...prev, uploadDetailLevel: level } : prev))
      const toastByLevel = {
        off: 'Sharing disabled',
        summary: 'Sharing summary only',
        detailed: 'Sharing detailed activities',
      } as const
      save({ uploadDetailLevel: level }, toastByLevel[level])
    },
    [save],
  )

  const commitDatabaseExportDirectory = useCallback(
    (databaseExportDirectory: string): void => {
      setForm((prev) => (prev ? { ...prev, databaseExportDirectory } : prev))
      void api.setDatabaseExportDirectory(databaseExportDirectory).then((result) => {
        if (!result.success) {
          toast.error(result.error ?? 'Failed to save folder', {
            id: 'auto-save-error',
            duration: 3000,
          })
          return
        }
        toast.success(
          databaseExportDirectory ? 'Raw DB export folder saved' : 'Raw DB export disabled',
          { id: 'auto-save', duration: 1500 },
        )
      })
    },
    [api],
  )

  const refreshCredentials = useCallback(async (): Promise<void> => {
    const statuses = await api.getCredentialStatuses()
    setCredentialStatuses(statuses)
    onCredentialsChanged?.()
  }, [api, onCredentialsChanged])

  const refreshActiveVendor = useCallback(async (): Promise<void> => {
    const [statuses, settings] = await Promise.all([
      api.getCredentialStatuses(),
      api.getCaptureSettings(),
    ])
    setCredentialStatuses(statuses)
    setForm(settings)
    onCredentialsChanged?.()
  }, [api, onCredentialsChanged])

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

  const showAiModels = editionConfig?.edition !== 'enterprise'
  const devMode = useDevMode()
  const handleTitleTap = useTapUnlock(() => {
    setDevMode(true)
    toast.success('Developer mode enabled')
  })

  return (
    <PageLayout
      title="Settings"
      onTitleClick={handleTitleTap}
      headerBefore={
        onBack && (
          <Button variant="ghost" size="sm" onClick={onBack}>
            &larr; Back to onboarding
          </Button>
        )
      }
    >
      {form && (
        <Tabs defaultValue={initialTab ?? 'privacy'}>
          <TabsList>
            <TabsTab value="privacy">Privacy</TabsTab>
            <TabsTab value="data">Data</TabsTab>
            {showAiModels && <TabsTab value="ai-models">AI models</TabsTab>}
            <TabsTab value="integrations">Integrations</TabsTab>
            {devMode && <TabsTab value="developer">Developer</TabsTab>}
          </TabsList>

          <TabsPanel value="privacy" className="pt-2">
            <CapturePrivacySection
              form={form}
              hotkeyPlatform={hotkeyPlatform}
              onToggleRecordingHotkey={() => setRecordingHotkey((current) => !current)}
              onAutoStartEnabledChange={setAutoStartEnabled}
              onExcludePrivateBrowsingChange={commitExcludePrivateBrowsing}
              onExcludedRulesCommit={commitExcludedRules}
              onObserved={() => void load()}
            />
          </TabsPanel>

          <TabsPanel value="data" className="pt-2">
            <DataTabPanel
              api={api}
              editionConfig={editionConfig}
              databaseExportDirectory={form.databaseExportDirectory}
              onDatabaseExportDirectoryChange={commitDatabaseExportDirectory}
              uploadDetailLevel={form.uploadDetailLevel}
              onUploadDetailLevelChange={setUploadDetailLevel}
            />
          </TabsPanel>

          {showAiModels && (
            <TabsPanel value="ai-models" className="pt-2">
              <AiModelsSection
                api={api}
                form={form}
                isEnterprise={editionConfig?.edition === 'enterprise'}
                credentialStatuses={credentialStatuses}
                onCredentialsChanged={() => void refreshCredentials()}
                onActiveVendorChanged={() => void refreshActiveVendor()}
                onSemanticPipelineModeChange={setSemanticPipelineMode}
                onSettingChange={setNumericSetting}
                onSettingCommit={commitNumericSetting}
                onModelChange={commitModelChange}
                onPatternDetectionEnabledChange={setPatternDetectionEnabled}
                onReset={() => void handleReset()}
              />
            </TabsPanel>
          )}

          <TabsPanel value="integrations" className="pt-2">
            <IntegrationsTabPanel api={api} />
          </TabsPanel>

          {devMode && (
            <TabsPanel value="developer" className="pt-2">
              <DeveloperSection api={api} />
            </TabsPanel>
          )}
        </Tabs>
      )}
    </PageLayout>
  )
}
