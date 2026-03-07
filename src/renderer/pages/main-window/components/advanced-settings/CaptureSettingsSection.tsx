import { useEffect, useState } from 'react'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import type { CaptureSettings, SemanticPipelineMode } from '@types'
import { formatHotkeyForDisplay, type HotkeyPlatform } from '../../hotkey-utils'
import { SectionToggle } from './SectionToggle'
import { SliderRow } from './SliderRow'
import type { NumericCaptureSetting } from './types'
import { formatMinSec, formatMs } from './utils'

interface CaptureSettingsSectionProps {
  open: boolean
  onToggle: () => void
  form: CaptureSettings
  hotkeyPlatform: HotkeyPlatform
  recordingHotkey: boolean
  onToggleRecordingHotkey: () => void
  onSemanticPipelineModeChange: (mode: SemanticPipelineMode) => void
  onSettingChange: (key: NumericCaptureSetting, value: number) => void
  onSettingCommit: (key: NumericCaptureSetting, value: number) => void
  onExcludedAppsCommit: (apps: string[]) => void
  onReset: () => void
}

function parseExcludedAppsInput(input: string): string[] {
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

export function CaptureSettingsSection({
  open,
  onToggle,
  form,
  hotkeyPlatform,
  recordingHotkey,
  onToggleRecordingHotkey,
  onSemanticPipelineModeChange,
  onSettingChange,
  onSettingCommit,
  onExcludedAppsCommit,
  onReset,
}: CaptureSettingsSectionProps): React.JSX.Element {
  const hotkeyPrimaryModifier = hotkeyPlatform === 'mac' ? 'Cmd' : 'Ctrl'
  const hotkeyAltModifier = hotkeyPlatform === 'mac' ? 'Option' : 'Alt'
  const excludedAppsText = form.excludedApps.join('\n')
  const [excludedAppsDraft, setExcludedAppsDraft] = useState(excludedAppsText)

  useEffect(() => {
    setExcludedAppsDraft(excludedAppsText)
  }, [excludedAppsText])

  return (
    <section>
      <SectionToggle label="Capture Settings" open={open} onToggle={onToggle} />
      {open && (
        <div className="mt-3 space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Semantic Media Pipeline</p>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant={form.semanticPipelineMode === 'auto' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onSemanticPipelineModeChange('auto')}
              >
                Auto
              </Button>
              <Button
                variant={form.semanticPipelineMode === 'video' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onSemanticPipelineModeChange('video')}
              >
                Video only
              </Button>
              <Button
                variant={form.semanticPipelineMode === 'image' ? 'default' : 'outline'}
                size="sm"
                onClick={() => onSemanticPipelineModeChange('image')}
              >
                Image only
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {form.semanticPipelineMode === 'auto'
                ? 'Tries video first, then falls back to images when needed.'
                : form.semanticPipelineMode === 'video'
                  ? 'Uses only the video pipeline and never falls back to images.'
                  : 'Uses only image snapshots and skips video requests.'}
            </p>
            <SliderRow
              label="LLM request timeout"
              value={form.semanticRequestTimeoutMs}
              min={15_000}
              max={300_000}
              step={5_000}
              format={formatMinSec}
              onChange={(v) => onSettingChange('semanticRequestTimeoutMs', v)}
              onCommit={(v) => onSettingCommit('semanticRequestTimeoutMs', v)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Label className="text-xs font-medium text-muted-foreground sm:w-24 sm:shrink-0">
                Capture Hotkey
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

          <div className="space-y-2">
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
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Excluded Apps (one per line)</Label>
            <textarea
              value={excludedAppsDraft}
              rows={4}
              className="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 h-auto rounded-none border bg-transparent px-2.5 py-2 text-xs transition-colors placeholder:text-muted-foreground w-full min-w-0 outline-none resize-y"
              placeholder={`keychain access\nsignal\nwhatsapp`}
              onChange={(event) => {
                setExcludedAppsDraft(event.target.value)
              }}
              onBlur={(event) => {
                const parsed = parseExcludedAppsInput(event.target.value)
                setExcludedAppsDraft(parsed.join('\n'))
                onExcludedAppsCommit(parsed)
              }}
            />
            <p className="text-xs text-muted-foreground">
              Matching is case-insensitive. Use app names like <code>signal</code> or{' '}
              <code>whatsapp</code>.
            </p>
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
    </section>
  )
}
