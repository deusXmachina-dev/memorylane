import { useEffect } from 'react'
import { toast } from 'sonner'
import { Cpu, Sparkles } from 'lucide-react'
import { Button } from '@components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@components/ui/select'
import { Switch } from '@components/ui/switch'
import type {
  CaptureSettings,
  MainWindowAPI,
  SemanticPipelineMode,
  Vendor,
  VendorStatus,
} from '@types'
import { VENDORS } from '@types'
import { VENDOR_PRESETS, getVendorDefaults } from '@/shared/vendor-defaults'
import { ManageKeySection } from '../ManageKeySection'
import { ModelSelector } from './ModelSelector'
import { SegmentedControl } from './SegmentedControl'
import { SettingsDisclosure } from './SettingsDisclosure'
import { SettingsRow } from './SettingsRow'
import { SettingsSection } from './SettingsSection'
import { SliderRow } from './SliderRow'
import type { NumericCaptureSetting } from './types'
import { formatMinSec, formatMs } from './utils'

const VENDOR_LABELS: Record<Vendor, string> = {
  openrouter: 'OpenRouter',
  google: 'Google Vertex AI',
  'openai-compatible': 'OpenAI-compatible',
}

interface AiModelsSectionProps {
  api: MainWindowAPI
  form: CaptureSettings
  isEnterprise: boolean
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
  onReset: () => void
}

export function AiModelsSection({
  api,
  form,
  isEnterprise,
  credentialStatuses,
  onCredentialsChanged,
  onActiveVendorChanged,
  onSemanticPipelineModeChange,
  onSettingChange,
  onSettingCommit,
  onModelChange,
  onPatternDetectionEnabledChange,
  onReset,
}: AiModelsSectionProps): React.JSX.Element {
  const activeVendor = form.activeVendor
  const activeStatus = credentialStatuses?.[activeVendor] ?? null
  const hasLlmAccess = activeStatus?.hasKey === true
  // Managed keys hide the advanced options below: models are chosen remotely
  // (DEU-202) and the tuning knobs aren't meant for managed installs.
  const isManagedKey = activeStatus?.source === 'managed'
  const vendorDefaults = getVendorDefaults(activeVendor)
  const videoSupported = vendorDefaults.semanticVideoModel.length > 0
  const visibleVendors = isEnterprise ? VENDORS : VENDORS.filter((v) => v !== 'google')

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
    <div className="space-y-6">
      <SettingsSection title="Vendor" icon={<Cpu className="h-4 w-4" />}>
        <SettingsRow
          layout="stacked"
          label="Active vendor"
          description="Each vendor remembers its own model selections."
          control={
            <Select
              value={activeVendor}
              onValueChange={(v) => void handleVendorChange(v as Vendor)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{(v) => VENDOR_LABELS[v as Vendor] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {visibleVendors.map((v) => (
                  <SelectItem key={v} value={v}>
                    {VENDOR_LABELS[v]}
                    {credentialStatuses?.[v]?.hasKey ? ' — key set' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        {activeStatus && (
          <div className="py-3 first:pt-0 last:pb-0">
            <ManageKeySection
              key={activeVendor}
              api={api}
              vendor={activeVendor}
              status={activeStatus}
              onChanged={onCredentialsChanged}
            />
          </div>
        )}
      </SettingsSection>

      {hasLlmAccess && (
        <SettingsSection title="Intelligence" icon={<Sparkles className="h-4 w-4" />}>
          <SettingsRow
            label="Automation opportunities"
            description="Analyzes your daily activity to find automatable workflows."
            control={
              <Switch
                checked={form.patternDetectionEnabled}
                onCheckedChange={onPatternDetectionEnabledChange}
                aria-label="Automation opportunities"
              />
            }
          />
          {!isManagedKey && (
            <div className="py-3 first:pt-0 last:pb-0">
              <SettingsDisclosure label="Advanced options">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Semantic media pipeline
                  </p>
                  <SegmentedControl
                    ariaLabel="Semantic media pipeline"
                    value={form.semanticPipelineMode}
                    onChange={onSemanticPipelineModeChange}
                    options={[
                      { value: 'auto', label: 'Auto', disabled: !videoSupported },
                      { value: 'video', label: 'Video only', disabled: !videoSupported },
                      { value: 'image', label: 'Image only' },
                    ]}
                  />
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
                  <p className="text-xs font-medium text-muted-foreground">Model selection</p>
                  {form.semanticPipelineMode !== 'image' && (
                    <ModelSelector
                      mode="freetext"
                      presets={VENDOR_PRESETS[activeVendor].semanticVideo}
                      value={form.semanticVideoModel}
                      defaultValue={vendorDefaults.semanticVideoModel}
                      onChange={(v) => onModelChange('semanticVideoModel', v)}
                      label="Video analysis model"
                    />
                  )}
                  {form.semanticPipelineMode !== 'video' && (
                    <ModelSelector
                      mode="freetext"
                      presets={VENDOR_PRESETS[activeVendor].semanticSnapshot}
                      value={form.semanticSnapshotModel}
                      defaultValue={vendorDefaults.semanticSnapshotModel}
                      onChange={(v) => onModelChange('semanticSnapshotModel', v)}
                      label="Snapshot analysis model"
                    />
                  )}
                  <ModelSelector
                    mode="freetext"
                    presets={VENDOR_PRESETS[activeVendor].patternDetection}
                    value={form.patternDetectionModel}
                    defaultValue={vendorDefaults.patternDetectionModel}
                    onChange={(v) => onModelChange('patternDetectionModel', v)}
                    label="Automation opportunities model"
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Capture sensitivity</p>
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
                  <p className="text-xs font-medium text-muted-foreground">Interaction timeouts</p>
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
                  <p className="text-xs font-medium text-muted-foreground">Activity windows</p>
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
              </SettingsDisclosure>
            </div>
          )}
        </SettingsSection>
      )}
    </div>
  )
}
