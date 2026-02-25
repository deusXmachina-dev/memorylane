import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Slider } from '@components/ui/slider'
import { Label } from '@components/ui/label'
import { Button } from '@components/ui/button'
import { CustomEndpointSection } from './components/CustomEndpointSection'
import { ManageKeySection } from './components/ManageKeySection'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import type { CaptureSettings, CustomEndpointStatus, KeyStatus } from '@types'

// base-ui fires onValueChange with `number | readonly number[]` depending on
// how the value prop was typed — normalise to a plain number either way.
function sliderVal(v: number | readonly number[]): number {
  return typeof v === 'number' ? v : v[0]
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(/\.0$/, '')}s`
  return `${Math.round(ms / 60_000)}min`
}

type SliderRowProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: SliderRowProps): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <span className="text-xs font-mono text-foreground tabular-nums">{format(value)}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(sliderVal(v))}
      />
    </div>
  )
}

export function AdvancedSettingsPage({ onBack }: { onBack: () => void }): React.JSX.Element {
  const api = useMainWindowAPI()
  const [form, setForm] = useState<CaptureSettings | null>(null)
  const [dirty, setDirty] = useState(false)
  const [endpointStatus, setEndpointStatus] = useState<CustomEndpointStatus | null>(null)
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null)

  const load = useCallback(async () => {
    const [s, ep, ks] = await Promise.all([
      api.getCaptureSettings(),
      api.getCustomEndpoint(),
      api.getKeyStatus(),
    ])
    setForm(s)
    setDirty(false)
    setEndpointStatus(ep)
    setKeyStatus(ks)
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const set = (key: keyof CaptureSettings, value: number): void => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
    setDirty(true)
  }

  const handleSave = async (): Promise<void> => {
    if (!form) return
    await api.saveCaptureSettings(form)
    setDirty(false)
    toast.success('Settings saved')
  }

  const handleReset = async (): Promise<void> => {
    await api.resetCaptureSettings()
    await load()
  }

  return (
    <div className="p-6 max-w-xl mx-auto space-y-5">
      <div className="flex items-center">
        <button
          onClick={onBack}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back
        </button>
      </div>

      <section className="space-y-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            LLM Config
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Use an OpenRouter API key or bring your own model.
          </p>
        </div>

        {keyStatus && !endpointStatus?.enabled && (
          <ManageKeySection
            api={api}
            keyStatus={keyStatus}
            onKeyDeleted={() => void api.getKeyStatus().then(setKeyStatus)}
            onKeyUpdated={() => void api.getKeyStatus().then(setKeyStatus)}
          />
        )}

        {endpointStatus && (
          <>
            {keyStatus && !endpointStatus.enabled && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="flex-1 h-px bg-border" />
                <span>or</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            )}
            <CustomEndpointSection
              api={api}
              endpointStatus={endpointStatus}
              onEndpointChanged={() => void api.getCustomEndpoint().then(setEndpointStatus)}
            />
          </>
        )}
      </section>

      {form && (
        <>
          <div className="border-t border-border" />

          <section className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Visual Change Detection
            </p>
            <SliderRow
              label="Sensitivity threshold"
              value={form.visualThreshold}
              min={1}
              max={20}
              step={1}
              format={(v) =>
                `${v}% — ${v <= 5 ? 'more captures' : v >= 15 ? 'fewer captures' : 'balanced'}`
              }
              onChange={(v) => set('visualThreshold', v)}
            />
          </section>

          <div className="border-t border-border" />

          <section className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Interaction Timeouts
            </p>
            <SliderRow
              label="Typing debounce"
              value={form.typingDebounceMs}
              min={500}
              max={10000}
              step={100}
              format={formatMs}
              onChange={(v) => set('typingDebounceMs', v)}
            />
            <SliderRow
              label="Scroll debounce"
              value={form.scrollDebounceMs}
              min={200}
              max={5000}
              step={100}
              format={formatMs}
              onChange={(v) => set('scrollDebounceMs', v)}
            />
            <SliderRow
              label="Click debounce"
              value={form.clickDebounceMs}
              min={500}
              max={10000}
              step={100}
              format={formatMs}
              onChange={(v) => set('clickDebounceMs', v)}
            />
          </section>

          <div className="border-t border-border" />

          <section className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Activity Windows
            </p>
            <SliderRow
              label="Minimum activity duration"
              value={form.minActivityDurationMs}
              min={1000}
              max={30000}
              step={1000}
              format={formatMs}
              onChange={(v) => set('minActivityDurationMs', v)}
            />
            <SliderRow
              label="Maximum activity duration"
              value={form.maxActivityDurationMs}
              min={60000}
              max={1800000}
              step={60000}
              format={formatMs}
              onChange={(v) => set('maxActivityDurationMs', v)}
            />
            <SliderRow
              label="Max screenshots per activity"
              value={form.maxScreenshotsPerActivity}
              min={5}
              max={50}
              step={1}
              format={(v) => `${v}`}
              onChange={(v) => set('maxScreenshotsPerActivity', v)}
            />
          </section>

          <div className="border-t border-border" />

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => void handleReset()}>
              Reset to defaults
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={!dirty}>
              Save
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
