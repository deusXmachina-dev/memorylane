import { Keyboard, ShieldCheck } from 'lucide-react'
import { Input } from '@components/ui/input'
import { Switch } from '@components/ui/switch'
import type { CaptureSettings } from '@types'
import { formatHotkeyForDisplay, type HotkeyPlatform } from '../../hotkey-utils'
import { ExclusionsManager } from './exclusions/ExclusionsManager'
import { SettingsRow } from './SettingsRow'
import { SettingsSection } from './SettingsSection'

interface CapturePrivacySectionProps {
  form: CaptureSettings
  hotkeyPlatform: HotkeyPlatform
  onToggleRecordingHotkey: () => void
  onAutoStartEnabledChange: (enabled: boolean) => void
  onExcludePrivateBrowsingChange: (enabled: boolean) => void
  onExcludedRulesCommit: (rules: { excludedApps: string[]; excludedUrlPatterns: string[] }) => void
  onObserved: () => void
}

export function CapturePrivacySection({
  form,
  hotkeyPlatform,
  onToggleRecordingHotkey,
  onAutoStartEnabledChange,
  onExcludePrivateBrowsingChange,
  onExcludedRulesCommit,
  onObserved,
}: CapturePrivacySectionProps): React.JSX.Element {
  const commitAppsChange = (nextApps: string[]): void => {
    onExcludedRulesCommit({
      excludedApps: nextApps,
      excludedUrlPatterns: form.excludedUrlPatterns,
    })
  }

  const commitUrlsChange = (nextUrls: string[]): void => {
    onExcludedRulesCommit({
      excludedApps: form.excludedApps,
      excludedUrlPatterns: nextUrls,
    })
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="Blocklist" icon={<ShieldCheck className="h-4 w-4" />}>
        <div className="py-3 first:pt-0 last:pb-0">
          <ExclusionsManager
            excludedApps={form.excludedApps}
            excludedUrlPatterns={form.excludedUrlPatterns}
            onAppsChange={commitAppsChange}
            onUrlsChange={commitUrlsChange}
            onObserved={onObserved}
          />
        </div>

        <SettingsRow
          label="Exclude private / incognito browsing"
          description="Any private browser window is skipped automatically."
          control={
            <Switch
              checked={form.excludePrivateBrowsing}
              onCheckedChange={onExcludePrivateBrowsingChange}
              aria-label="Exclude private browsing"
            />
          }
        />

        <SettingsRow
          label="Launch at login"
          description="Start MemoryLane quietly when your Mac boots."
          control={
            <Switch
              checked={form.autoStartEnabled}
              onCheckedChange={onAutoStartEnabledChange}
              aria-label="Launch at login"
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Shortcut" icon={<Keyboard className="h-4 w-4" />}>
        <SettingsRow
          layout="stacked"
          label="Start / stop shortcut"
          description="Click the field, then press your shortcut. Esc cancels."
          control={
            <Input
              value={formatHotkeyForDisplay(form.captureHotkeyAccelerator, hotkeyPlatform)}
              readOnly
              className="w-full cursor-pointer"
              onClick={onToggleRecordingHotkey}
            />
          }
        />
      </SettingsSection>
    </div>
  )
}
