import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Slider } from '@components/ui/slider'
import { Label } from '@components/ui/label'
import { Button } from '@components/ui/button'
import { DatabaseExportSection } from './components/DatabaseExportSection'
import { CustomEndpointSection } from './components/CustomEndpointSection'
import { ManageKeySection } from './components/ManageKeySection'
import { SlackIntegrationSection } from './components/SlackIntegrationSection'
import { useMainWindowAPI } from '@/renderer/hooks/use-main-window-api'
import type {
  CaptureSettings,
  CustomEndpointStatus,
  KeyStatus,
  SemanticPipelineMode,
  SlackIntegrationStatus,
} from '@types'

function sliderVal(v: number | readonly number[]): number {
  return typeof v === 'number' ? v : v[0]
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(/\.0$/, '')}s`
  return `${Math.round(ms / 60_000)}min`
}

function formatMinSec(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}

type SliderRowProps = {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  onCommit: (v: number) => void
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  onCommit,
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
        onValueCommitted={(v) => onCommit(sliderVal(v))}
      />
    </div>
  )
}

function SectionToggle({
  label,
  open,
  onToggle,
}: {
  label: string
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
      onClick={onToggle}
    >
      <span className="text-[10px]">{open ? '\u25BC' : '\u25B6'}</span>
      {label}
    </button>
  )
}

export function AdvancedSettingsPage({ onBack }: { onBack: () => void }): React.JSX.Element {
  const api = useMainWindowAPI()
  const [form, setForm] = useState<CaptureSettings | null>(null)
  const [endpointStatus, setEndpointStatus] = useState<CustomEndpointStatus | null>(null)
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null)
  const [slackStatus, setSlackStatus] = useState<SlackIntegrationStatus | null>(null)
  const [llmOpen, setLlmOpen] = useState(false)
  const [dataOpen, setDataOpen] = useState(false)
  const [startupOpen, setStartupOpen] = useState(false)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [slackOpen, setSlackOpen] = useState(false)

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

  type NumericCaptureSetting = Exclude<
    keyof CaptureSettings,
    'autoStartEnabled' | 'semanticPipelineMode'
  >

  const set = (key: NumericCaptureSetting, value: number): void => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  const commit = (key: NumericCaptureSetting, value: number): void => {
    if (!form) return
    const next = { ...form, [key]: value }
    setForm(next)
    save(next)
  }

  const setSemanticPipelineMode = (mode: SemanticPipelineMode): void => {
    if (!form) return
    const next = { ...form, semanticPipelineMode: mode }
    setForm(next)
    save(next)
  }

  const setAutoStartEnabled = (enabled: boolean): void => {
    if (!form) return
    const next = { ...form, autoStartEnabled: enabled }
    setForm(next)
    save(next, enabled ? 'Launch at login enabled' : 'Launch at login disabled')
  }

  const handleReset = async (): Promise<void> => {
    await api.resetCaptureSettings()
    await load()
  }

  return (
    <div className="p-6 max-w-xl mx-auto space-y-4 overflow-y-auto max-h-screen">
      <button
        onClick={onBack}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        ← Back
      </button>

      {/* ── LLM Configuration ── */}
      <section>
        <SectionToggle
          label="LLM Configuration"
          open={llmOpen}
          onToggle={() => setLlmOpen((v) => !v)}
        />
        {llmOpen && (
          <div className="mt-3 space-y-3">
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
          </div>
        )}
      </section>

      <div className="border-t border-border" />

      {form && (
        <>
          <section>
            <SectionToggle
              label="App Startup"
              open={startupOpen}
              onToggle={() => setStartupOpen((v) => !v)}
            />
            {startupOpen && (
              <div className="mt-3 space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        Should the app start on login?
                      </p>
                    </div>
                    <div className="grid shrink-0 grid-cols-2 gap-2">
                      <Button
                        variant={form.autoStartEnabled ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setAutoStartEnabled(true)}
                      >
                        On
                      </Button>
                      <Button
                        variant={!form.autoStartEnabled ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setAutoStartEnabled(false)}
                      >
                        Off
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          <div className="border-t border-border" />
        </>
      )}

      {/* ── Data Management ── */}
      <section>
        <SectionToggle
          label="Data Management"
          open={dataOpen}
          onToggle={() => setDataOpen((v) => !v)}
        />
        {dataOpen && (
          <div className="mt-3">
            <DatabaseExportSection api={api} />
          </div>
        )}
      </section>

      {form && (
        <>
          <div className="border-t border-border" />

          <section>
            <SectionToggle
              label="Slack Integration"
              open={slackOpen}
              onToggle={() => setSlackOpen((value) => !value)}
            />
            {slackOpen && slackStatus && (
              <div className="mt-3">
                <SlackIntegrationSection
                  api={api}
                  status={slackStatus}
                  onChanged={() => void load()}
                />
              </div>
            )}
          </section>

          <div className="border-t border-border" />

          {/* ── Capture Settings ── */}
          <section>
            <SectionToggle
              label="Capture Settings"
              open={captureOpen}
              onToggle={() => setCaptureOpen((v) => !v)}
            />
            {captureOpen && (
              <div className="mt-3 space-y-5">
                {/* Semantic Media Pipeline */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Semantic Media Pipeline
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      variant={form.semanticPipelineMode === 'auto' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSemanticPipelineMode('auto')}
                    >
                      Auto
                    </Button>
                    <Button
                      variant={form.semanticPipelineMode === 'video' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSemanticPipelineMode('video')}
                    >
                      Video only
                    </Button>
                    <Button
                      variant={form.semanticPipelineMode === 'image' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSemanticPipelineMode('image')}
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
                    onChange={(v) => set('semanticRequestTimeoutMs', v)}
                    onCommit={(v) => commit('semanticRequestTimeoutMs', v)}
                  />
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
                    onChange={(v) => set('visualThreshold', v)}
                    onCommit={(v) => commit('visualThreshold', v)}
                  />
                </div>

                {/* Interaction Timeouts */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Interaction Timeouts</p>
                  <SliderRow
                    label="Typing debounce"
                    value={form.typingDebounceMs}
                    min={500}
                    max={10000}
                    step={100}
                    format={formatMs}
                    onChange={(v) => set('typingDebounceMs', v)}
                    onCommit={(v) => commit('typingDebounceMs', v)}
                  />
                  <SliderRow
                    label="Scroll debounce"
                    value={form.scrollDebounceMs}
                    min={200}
                    max={5000}
                    step={100}
                    format={formatMs}
                    onChange={(v) => set('scrollDebounceMs', v)}
                    onCommit={(v) => commit('scrollDebounceMs', v)}
                  />
                  <SliderRow
                    label="Click debounce"
                    value={form.clickDebounceMs}
                    min={500}
                    max={10000}
                    step={100}
                    format={formatMs}
                    onChange={(v) => set('clickDebounceMs', v)}
                    onCommit={(v) => commit('clickDebounceMs', v)}
                  />
                </div>

                {/* Activity Windows */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Activity Windows</p>
                  <SliderRow
                    label="Minimum activity duration"
                    value={form.minActivityDurationMs}
                    min={1000}
                    max={30000}
                    step={1000}
                    format={formatMs}
                    onChange={(v) => set('minActivityDurationMs', v)}
                    onCommit={(v) => commit('minActivityDurationMs', v)}
                  />
                  <SliderRow
                    label="Maximum activity duration"
                    value={form.maxActivityDurationMs}
                    min={60000}
                    max={1800000}
                    step={60000}
                    format={formatMs}
                    onChange={(v) => set('maxActivityDurationMs', v)}
                    onCommit={(v) => commit('maxActivityDurationMs', v)}
                  />
                  <SliderRow
                    label="Max snapshots for AI"
                    value={form.maxScreenshotsPerActivity}
                    min={1}
                    max={12}
                    step={1}
                    format={(v) => `${v}`}
                    onChange={(v) => set('maxScreenshotsPerActivity', v)}
                    onCommit={(v) => commit('maxScreenshotsPerActivity', v)}
                  />
                </div>

                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" onClick={() => void handleReset()}>
                    Reset to defaults
                  </Button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
