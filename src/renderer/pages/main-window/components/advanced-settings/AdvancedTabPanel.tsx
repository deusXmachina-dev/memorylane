import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import type { CaptureSettings } from '@types'
import { formatHotkeyForDisplay, type HotkeyPlatform } from '../../hotkey-utils'
import { SliderRow } from './SliderRow'
import type { NumericCaptureSetting } from './types'
import { formatMs } from './utils'

interface AdvancedTabPanelProps {
  form: CaptureSettings
  hotkeyPlatform: HotkeyPlatform
  onToggleRecordingHotkey: () => void
  onSettingChange: (key: NumericCaptureSetting, value: number) => void
  onSettingCommit: (key: NumericCaptureSetting, value: number) => void
  onReset: () => void
}

export function AdvancedTabPanel({
  form,
  hotkeyPlatform,
  onToggleRecordingHotkey,
  onSettingChange,
  onSettingCommit,
  onReset,
}: AdvancedTabPanelProps): React.JSX.Element {
  return (
    <section className="space-y-5">
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
    </section>
  )
}
