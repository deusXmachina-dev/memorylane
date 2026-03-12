import { useEffect, useState } from 'react'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import { Textarea } from '@components/ui/textarea'
import type { CaptureSettings } from '@types'
import { formatHotkeyForDisplay, type HotkeyPlatform } from '../../hotkey-utils'
import { SectionToggle } from './SectionToggle'
import { SliderRow } from './SliderRow'
import type { NumericCaptureSetting } from './types'
import { formatMs } from './utils'

interface CapturePrivacySectionProps {
  open: boolean
  onToggle: () => void
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
  onReset: () => void
}

function parseInputList(input: string): string[] {
  const seen = new Set<string>()
  const parsed: string[] = []

  for (const line of input.split('\n')) {
    const value = line.trim()
    if (value.length === 0) continue
    const dedupeKey = value.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    parsed.push(value)
  }

  return parsed
}

export function CapturePrivacySection({
  open,
  onToggle,
  form,
  hotkeyPlatform,
  recordingHotkey,
  onToggleRecordingHotkey,
  onAutoStartEnabledChange,
  onSettingChange,
  onSettingCommit,
  onExcludePrivateBrowsingChange,
  onExcludedRulesCommit,
  onReset,
}: CapturePrivacySectionProps): React.JSX.Element {
  const hotkeyPrimaryModifier = hotkeyPlatform === 'mac' ? 'Cmd' : 'Ctrl'
  const hotkeyAltModifier = hotkeyPlatform === 'mac' ? 'Option' : 'Alt'

  const [advancedOpen, setAdvancedOpen] = useState(false)

  const excludedAppsText = form.excludedApps.join('\n')
  const excludedWindowTitlePatternsText = form.excludedWindowTitlePatterns.join('\n')
  const excludedUrlPatternsText = form.excludedUrlPatterns.join('\n')
  const [excludedAppsDraft, setExcludedAppsDraft] = useState(excludedAppsText)
  const [excludedWindowTitlePatternsDraft, setExcludedWindowTitlePatternsDraft] = useState(
    excludedWindowTitlePatternsText,
  )
  const [excludedUrlPatternsDraft, setExcludedUrlPatternsDraft] = useState(excludedUrlPatternsText)
  const [hasPendingChanges, setHasPendingChanges] = useState(false)

  useEffect(() => {
    if (hasPendingChanges) return
    setExcludedAppsDraft(excludedAppsText)
  }, [excludedAppsText, hasPendingChanges])
  useEffect(() => {
    if (hasPendingChanges) return
    setExcludedWindowTitlePatternsDraft(excludedWindowTitlePatternsText)
  }, [excludedWindowTitlePatternsText, hasPendingChanges])
  useEffect(() => {
    if (hasPendingChanges) return
    setExcludedUrlPatternsDraft(excludedUrlPatternsText)
  }, [excludedUrlPatternsText, hasPendingChanges])

  const commitDrafts = (): void => {
    const nextExcludedApps = parseInputList(excludedAppsDraft)
    const nextExcludedWindowTitlePatterns = parseInputList(excludedWindowTitlePatternsDraft)
    const nextExcludedUrlPatterns = parseInputList(excludedUrlPatternsDraft)

    setExcludedAppsDraft(nextExcludedApps.join('\n'))
    setExcludedWindowTitlePatternsDraft(nextExcludedWindowTitlePatterns.join('\n'))
    setExcludedUrlPatternsDraft(nextExcludedUrlPatterns.join('\n'))
    setHasPendingChanges(false)

    onExcludedRulesCommit({
      excludedApps: nextExcludedApps,
      excludedWindowTitlePatterns: nextExcludedWindowTitlePatterns,
      excludedUrlPatterns: nextExcludedUrlPatterns,
    })
  }

  return (
    <section>
      <SectionToggle label="Capture & Privacy" open={open} onToggle={onToggle} />
      {open && (
        <div className="mt-3 space-y-5">
          {/* Start on login */}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-muted-foreground">Start on login</p>
            <div className="grid shrink-0 grid-cols-2 gap-2">
              <Button
                variant={form.autoStartEnabled ? 'default' : 'outline'}
                size="sm"
                onClick={() => onAutoStartEnabledChange(true)}
              >
                On
              </Button>
              <Button
                variant={!form.autoStartEnabled ? 'default' : 'outline'}
                size="sm"
                onClick={() => onAutoStartEnabledChange(false)}
              >
                Off
              </Button>
            </div>
          </div>

          {/* Start/Stop hotkey */}
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Label className="text-xs font-medium text-muted-foreground sm:w-24 sm:shrink-0">
                Start/Stop Shortcut
              </Label>
              <div className="flex flex-1 items-center gap-2">
                <Input
                  value={formatHotkeyForDisplay(form.captureHotkeyAccelerator, hotkeyPlatform)}
                  readOnly
                />
                <Button
                  type="button"
                  variant={recordingHotkey ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={onToggleRecordingHotkey}
                >
                  {recordingHotkey ? 'Cancel' : 'Record'}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {recordingHotkey
                ? 'Press your key combination now (Esc to cancel).'
                : `Example: ${hotkeyPrimaryModifier}+Shift+M or ${hotkeyPrimaryModifier}+${hotkeyAltModifier}+P`}
            </p>
          </div>

          {/* Visual change sensitivity */}
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

          {/* Exclude private browsing */}
          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs text-muted-foreground">Exclude Private Browsing</Label>
            <div
              role="group"
              aria-label="Exclude Private Browsing"
              className="grid shrink-0 grid-cols-2 gap-2"
            >
              <Button
                variant={form.excludePrivateBrowsing ? 'default' : 'outline'}
                size="sm"
                aria-pressed={form.excludePrivateBrowsing}
                onClick={() => onExcludePrivateBrowsingChange(true)}
              >
                On
              </Button>
              <Button
                variant={!form.excludePrivateBrowsing ? 'default' : 'outline'}
                size="sm"
                aria-pressed={!form.excludePrivateBrowsing}
                onClick={() => onExcludePrivateBrowsingChange(false)}
              >
                Off
              </Button>
            </div>
          </div>

          {/* Excluded rules */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Excluded Apps (one per line)</Label>
            <Textarea
              value={excludedAppsDraft}
              rows={4}
              className="text-xs resize-y"
              placeholder={`keychain access\nsignal\nwhatsapp`}
              onChange={(event) => {
                setExcludedAppsDraft(event.target.value)
                setHasPendingChanges(true)
              }}
            />
            <p className="ml-2 -mt-1 text-[11px] text-muted-foreground">
              Matching is case-insensitive. Use app names like <code>signal</code> or{' '}
              <code>whatsapp</code>.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Excluded Window Titles (one per line)
            </Label>
            <Textarea
              value={excludedWindowTitlePatternsDraft}
              rows={3}
              className="text-xs resize-y"
              placeholder={`bank statement\nlab results\npayroll`}
              onChange={(event) => {
                setExcludedWindowTitlePatternsDraft(event.target.value)
                setHasPendingChanges(true)
              }}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Excluded URLs (one per line)</Label>
            <Textarea
              value={excludedUrlPatternsDraft}
              rows={3}
              className="text-xs resize-y"
              placeholder={`bank.com\nmychart\nmail.google.com`}
              onChange={(event) => {
                setExcludedUrlPatternsDraft(event.target.value)
                setHasPendingChanges(true)
              }}
            />
          </div>

          <div className="-mt-2 ml-2 space-y-1">
            <p className="text-[11px] text-muted-foreground">
              Examples above match anywhere. <code>*</code> matches any text. <code>?</code> matches
              one character.
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={commitDrafts}
              disabled={!hasPendingChanges}
            >
              Save privacy rules
            </Button>
          </div>

          {/* Advanced sub-section */}
          <div className="border-t border-border pt-3">
            <button
              type="button"
              className="flex w-full items-center gap-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setAdvancedOpen((v) => !v)}
            >
              <span className="text-[9px]">{advancedOpen ? '\u25BC' : '\u25B6'}</span>
              Advanced
            </button>
            {advancedOpen && (
              <div className="mt-3 space-y-4">
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
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={onReset}>
              Reset to defaults
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
