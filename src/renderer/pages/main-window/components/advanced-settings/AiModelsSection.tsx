import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components/ui/select'
import type {
  CaptureSettings,
  MainWindowAPI,
  SemanticPipelineMode,
  Vendor,
  VendorStatus,
} from '@types'
import { VENDORS } from '@types'
import { ManageKeySection } from '../ManageKeySection'
import { SectionToggle } from './SectionToggle'
import { SubSectionToggle } from './SubSectionToggle'
import { SliderRow } from './SliderRow'
import { ModelSelector } from './ModelSelector'
import type { ModelPreset } from './ModelSelector'
import type { NumericCaptureSetting } from './types'
import { formatMinSec } from './utils'

const VENDOR_LABELS: Record<Vendor, string> = {
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  'openai-compatible': 'OpenAI-compatible',
}

const VENDOR_VIDEO_PRESETS: Record<Vendor, ModelPreset[]> = {
  openrouter: [
    { id: 'google/gemini-2.5-flash-lite-preview-09-2025', label: 'Gemini Flash Lite' },
    { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
    { id: 'allenai/molmo-2-8b', label: 'Molmo 2 8B' },
  ],
  openai: [],
  anthropic: [],
  google: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  ],
  'openai-compatible': [],
}

const VENDOR_SNAPSHOT_PRESETS: Record<Vendor, ModelPreset[]> = {
  openrouter: [
    { id: 'mistralai/mistral-small-3.2-24b-instruct', label: 'Mistral Small 3.2' },
    { id: 'google/gemini-2.5-flash-lite', label: 'Gemini Flash Lite' },
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
  ],
  anthropic: [
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  ],
  google: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }],
  'openai-compatible': [],
}

const VENDOR_PATTERN_PRESETS: Record<Vendor, ModelPreset[]> = {
  openrouter: [{ id: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5' }],
  openai: [{ id: 'gpt-4o-mini', label: 'GPT-4o mini' }],
  anthropic: [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }],
  google: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }],
  'openai-compatible': [],
}

interface AiModelsSectionProps {
  api: MainWindowAPI
  open: boolean
  onToggle: () => void
  form: CaptureSettings
  credentialStatuses: Record<Vendor, VendorStatus> | null
  onCredentialsChanged: () => void
  onActiveVendorChanged: () => void
  onSemanticPipelineModeChange: (mode: SemanticPipelineMode) => void
  onSettingChange: (key: NumericCaptureSetting, value: number) => void
  onSettingCommit: (key: NumericCaptureSetting, value: number) => void
  onModelChange: (
    key: 'semanticVideoModel' | 'semanticSnapshotModel' | 'patternDetectionModel',
    value: string,
  ) => void
  onPatternDetectionEnabledChange: (enabled: boolean) => void
}

export function AiModelsSection({
  api,
  open,
  onToggle,
  form,
  credentialStatuses,
  onCredentialsChanged,
  onActiveVendorChanged,
  onSemanticPipelineModeChange,
  onSettingChange,
  onSettingCommit,
  onModelChange,
  onPatternDetectionEnabledChange,
}: AiModelsSectionProps): React.JSX.Element {
  const activeVendor = form.activeVendor
  const activeStatus = credentialStatuses?.[activeVendor] ?? null
  const hasLlmAccess = activeStatus?.hasKey === true
  const selectorMode: 'preset' | 'freetext' =
    activeStatus?.source === 'managed' ? 'preset' : 'freetext'
  const videoSupported = form.semanticVideoModel.length > 0
  const [moreOpen, setMoreOpen] = useState(false)

  // When the active vendor has no video model, lock the pipeline to 'image'.
  useEffect(() => {
    if (!videoSupported && form.semanticPipelineMode !== 'image') {
      onSemanticPipelineModeChange('image')
    }
  }, [videoSupported, form.semanticPipelineMode, onSemanticPipelineModeChange])

  const handleVendorChange = async (vendor: Vendor): Promise<void> => {
    if (vendor === activeVendor) return
    const result = await api.setActiveVendor(vendor)
    if (result.success) {
      toast.success(`Switched to ${VENDOR_LABELS[vendor]}`)
      onActiveVendorChanged()
    } else {
      toast.error(result.error ?? 'Failed to switch vendor')
    }
  }

  return (
    <section>
      <SectionToggle label="AI Models" open={open} onToggle={onToggle} />
      {open && (
        <div className="mt-3 space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Active Vendor</p>
            <Select
              value={activeVendor}
              onValueChange={(v) => void handleVendorChange(v as Vendor)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VENDORS.map((v) => (
                  <SelectItem key={v} value={v}>
                    {VENDOR_LABELS[v]}
                    {credentialStatuses?.[v]?.hasKey ? ' — key set' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Switching vendor resets the model selections to that vendor's defaults.
            </p>
          </div>

          {activeStatus && (
            <ManageKeySection
              api={api}
              vendor={activeVendor}
              status={activeStatus}
              onChanged={onCredentialsChanged}
            />
          )}

          {hasLlmAccess && (
            <div>
              <div className="space-y-2 mb-4">
                <p className="text-xs font-medium text-muted-foreground">
                  Automation Opportunities
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant={form.patternDetectionEnabled ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => onPatternDetectionEnabledChange(true)}
                  >
                    On
                  </Button>
                  <Button
                    variant={!form.patternDetectionEnabled ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => onPatternDetectionEnabledChange(false)}
                  >
                    Off
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Analyzes your daily activity to find automatable workflows.
                </p>
              </div>
              <SubSectionToggle
                label="More"
                open={moreOpen}
                onToggle={() => setMoreOpen((v) => !v)}
              />
              {moreOpen && (
                <div className="mt-3 space-y-4">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Semantic Media Pipeline
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      <Button
                        variant={form.semanticPipelineMode === 'auto' ? 'default' : 'outline'}
                        size="sm"
                        disabled={!videoSupported}
                        onClick={() => onSemanticPipelineModeChange('auto')}
                      >
                        Auto
                      </Button>
                      <Button
                        variant={form.semanticPipelineMode === 'video' ? 'default' : 'outline'}
                        size="sm"
                        disabled={!videoSupported}
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
                      {!videoSupported
                        ? `${VENDOR_LABELS[activeVendor]} has no default video model — using image snapshots only.`
                        : form.semanticPipelineMode === 'auto'
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
                  <div className="space-y-3">
                    <p className="text-xs font-medium text-muted-foreground">Model Selection</p>
                    {form.semanticPipelineMode !== 'image' && (
                      <ModelSelector
                        mode={selectorMode}
                        presets={VENDOR_VIDEO_PRESETS[activeVendor]}
                        value={form.semanticVideoModel}
                        defaultValue={form.semanticVideoModel}
                        onChange={(v) => onModelChange('semanticVideoModel', v)}
                        label="Video analysis model"
                      />
                    )}
                    {form.semanticPipelineMode !== 'video' && (
                      <ModelSelector
                        mode={selectorMode}
                        presets={VENDOR_SNAPSHOT_PRESETS[activeVendor]}
                        value={form.semanticSnapshotModel}
                        defaultValue={form.semanticSnapshotModel}
                        onChange={(v) => onModelChange('semanticSnapshotModel', v)}
                        label="Snapshot analysis model"
                      />
                    )}
                    <ModelSelector
                      mode={selectorMode}
                      presets={VENDOR_PATTERN_PRESETS[activeVendor]}
                      value={form.patternDetectionModel}
                      defaultValue={form.patternDetectionModel}
                      onChange={(v) => onModelChange('patternDetectionModel', v)}
                      label="Automation opportunities model"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
