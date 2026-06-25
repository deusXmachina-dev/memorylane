import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ExclusionsManager } from '../advanced-settings/exclusions/ExclusionsManager'
import { OnboardingStep } from './OnboardingStep'
import type { CaptureSettings, MainWindowAPI } from '@types'

interface BlacklistStepProps {
  api: MainWindowAPI
  onContinue: () => void
}

export function BlacklistStep({ api, onContinue }: BlacklistStepProps): React.JSX.Element {
  const [settings, setSettings] = useState<CaptureSettings | null>(null)

  const load = useCallback(async () => {
    setSettings(await api.getCaptureSettings())
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(
    (patch: Partial<CaptureSettings>) => {
      setSettings((prev) => (prev ? { ...prev, ...patch } : prev))
      void api.saveCaptureSettings(patch).then((result) => {
        if (!result.success) toast.error(result.error ?? 'Failed to save')
      })
    },
    [api],
  )

  const handleAppsChange = useCallback(
    (next: string[]) => {
      save({ excludedApps: next })
    },
    [save],
  )

  const handleUrlsChange = useCallback(
    (next: string[]) => {
      save({ excludedUrlPatterns: next })
    },
    [save],
  )

  if (settings === null) return <div />

  return (
    <OnboardingStep>
      <OnboardingStep.Header
        title="Block what you don't want captured"
        subtitle="Optional. Add apps or websites that should never be captured. You can change this anytime in settings."
      />

      <ExclusionsManager
        excludedApps={settings.excludedApps}
        excludedUrlPatterns={settings.excludedUrlPatterns}
        onAppsChange={handleAppsChange}
        onUrlsChange={handleUrlsChange}
        onObserved={() => void load()}
      />

      <OnboardingStep.Button onClick={onContinue}>Continue</OnboardingStep.Button>
    </OnboardingStep>
  )
}
