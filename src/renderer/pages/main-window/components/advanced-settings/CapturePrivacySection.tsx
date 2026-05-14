import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Card, CardContent } from '@components/ui/card'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import { Switch } from '@components/ui/switch'
import type { CaptureSettings } from '@types'
import { formatHotkeyForDisplay, type HotkeyPlatform } from '../../hotkey-utils'
import { SubSectionToggle } from './SubSectionToggle'
import { SliderRow } from './SliderRow'
import type { NumericCaptureSetting } from './types'
import { formatMs } from './utils'
import { ExclusionsManager } from './exclusions/ExclusionsManager'

interface CapturePrivacySectionProps {
  form: CaptureSettings
  hotkeyPlatform: HotkeyPlatform
  recordingHotkey: boolean
  onToggleRecordingHotkey: () => void
  onAutoStartEnabledChange: (enabled: boolean) => void
  onSettingChange: (key: NumericCaptureSetting, value: number) => void
  onSettingCommit: (key: NumericCaptureSetting, value: number) => void
  onExcludePrivateBrowsingChange: (enabled: boolean) => void
  onExcludedRulesCommit: (rules: {
    excludedApps: string[]
    excludedWindowTitlePatterns: string[]
    excludedUrlPatterns: string[]
  }) => void
  onObserved: () => void
  onReset: () => void
}

export function CapturePrivacySection({
  form,
  hotkeyPlatform,
  recordingHotkey,
  onToggleRecordingHotkey,
  onAutoStartEnabledChange,
  onSettingChange,
  onSettingCommit,
  onExcludePrivateBrowsingChange,
  onExcludedRulesCommit,
  onObserved,
  onReset,
}: CapturePrivacySectionProps): React.JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false)

  const commitAppsChange = (nextApps: string[]): void => {
    onExcludedRulesCommit({
      excludedApps: nextApps,
      excludedWindowTitlePatterns: form.excludedWindowTitlePatterns,
      excludedUrlPatterns: form.excludedUrlPatterns,
    })
  }

  const commitUrlsChange = (nextUrls: string[]): void => {
    onExcludedRulesCommit({
      excludedApps: form.excludedApps,
      excludedWindowTitlePatterns: form.excludedWindowTitlePatterns,
      excludedUrlPatterns: nextUrls,
    })
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <ShieldCheck className="h-4 w-4" />
        Privacy rules
      </div>

      <Card>
        <CardContent className="space-y-5">
          <ExclusionsManager
            layout="stacked"
            excludedApps={form.excludedApps}
            excludedUrlPatterns={form.excludedUrlPatterns}
            onAppsChange={commitAppsChange}
            onUrlsChange={commitUrlsChange}
            onObserved={onObserved}
          />

          <div className="border-t border-border" />

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium text-foreground">
                Exclude private / incognito browsing
              </Label>
              <p className="text-xs text-muted-foreground">
                Any private browser window is skipped automatically.
              </p>
            </div>
            <Switch
              checked={form.excludePrivateBrowsing}
              onCheckedChange={onExcludePrivateBrowsingChange}
              aria-label="Exclude private browsing"
            />
          </div>

          <div className="border-t border-border" />

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium text-foreground">Launch at login</Label>
              <p className="text-xs text-muted-foreground">
                Start MemoryLane quietly when your Mac boots.
              </p>
            </div>
            <Switch
              checked={form.autoStartEnabled}
              onCheckedChange={onAutoStartEnabledChange}
              aria-label="Launch at login"
            />
          </div>
        </CardContent>
      </Card>

      <div className="pl-2">
        <SubSectionToggle
          label="More"
          open={moreOpen}
          onToggle={() => {
            setMoreOpen((v) => {
              if (v && recordingHotkey) onToggleRecordingHotkey()
              return !v
            })
          }}
        />
        {moreOpen && (
          <div className="mt-3 space-y-5">
            <SliderRow
              label="Visual change sensitivity"
              value={form.visualThreshold}
              min={1}
              max={20}
              step={1}
              format={(v) =>
                `${v}% — ${v <= 5 ? 'more captures' : v >= 15 ? 'fewer captures' : 'balanced'}`
              }
              onChange={(v) => onSettingChange('visualThreshold', v)}
              onCommit={(v) => onSettingCommit('visualThreshold', v)}
            />

            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium text-muted-foreground shrink-0 whitespace-nowrap">
                Start/Stop Shortcut
              </Label>
              <Input
                value={formatHotkeyForDisplay(form.captureHotkeyAccelerator, hotkeyPlatform)}
                readOnly
                className="flex-1 cursor-pointer"
                onClick={onToggleRecordingHotkey}
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Interaction Timeouts</p>
              <SliderRow
                label="Typing debounce"
                value={form.typingDebounceMs}
                min={500}
                max={10_000}
                step={100}
                format={formatMs}
                onChange={(v) => onSettingChange('typingDebounceMs', v)}
                onCommit={(v) => onSettingCommit('typingDebounceMs', v)}
              />
              <SliderRow
                label="Scroll debounce"
                value={form.scrollDebounceMs}
                min={200}
                max={5_000}
                step={100}
                format={formatMs}
                onChange={(v) => onSettingChange('scrollDebounceMs', v)}
                onCommit={(v) => onSettingCommit('scrollDebounceMs', v)}
              />
              <SliderRow
                label="Click debounce"
                value={form.clickDebounceMs}
                min={500}
                max={10_000}
                step={100}
                format={formatMs}
                onChange={(v) => onSettingChange('clickDebounceMs', v)}
                onCommit={(v) => onSettingCommit('clickDebounceMs', v)}
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Activity Windows</p>
              <SliderRow
                label="Minimum activity duration"
                value={form.minActivityDurationMs}
                min={1_000}
                max={30_000}
                step={1_000}
                format={formatMs}
                onChange={(v) => onSettingChange('minActivityDurationMs', v)}
                onCommit={(v) => onSettingCommit('minActivityDurationMs', v)}
              />
              <SliderRow
                label="Maximum activity duration"
                value={form.maxActivityDurationMs}
                min={60_000}
                max={1_800_000}
                step={60_000}
                format={formatMs}
                onChange={(v) => onSettingChange('maxActivityDurationMs', v)}
                onCommit={(v) => onSettingCommit('maxActivityDurationMs', v)}
              />
              <SliderRow
                label="Max screenshots for LLM"
                value={form.maxScreenshotsForLlm}
                min={1}
                max={20}
                step={1}
                format={(v) => `${v}`}
                onChange={(v) => onSettingChange('maxScreenshotsForLlm', v)}
                onCommit={(v) => onSettingCommit('maxScreenshotsForLlm', v)}
              />
            </div>

            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={onReset}>
                Reset to defaults
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
