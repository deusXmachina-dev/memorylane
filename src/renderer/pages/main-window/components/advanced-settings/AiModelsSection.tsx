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
import { VENDOR_PRESETS, getVendorDefaults } from '@/shared/vendor-defaults'
import { ManageKeySection } from '../ManageKeySection'
import { SectionToggle } from './SectionToggle'
import { SubSectionToggle } from './SubSectionToggle'
import { SliderRow } from './SliderRow'
import { ModelSelector } from './ModelSelector'
import type { NumericCaptureSetting } from './types'
import { formatMinSec } from './utils'

const VENDOR_LABELS: Record<Vendor, string> = {
  openrouter: 'OpenRouter',
  google: 'Google Vertex AI',
  'openai-compatible': 'OpenAI-compatible',
}

interface AiModelsSectionProps {
  api: MainWindowAPI
  open: boolean
  onToggle: () => void
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
}

export function AiModelsSection({
  api,
  open,
  onToggle,
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
}: AiModelsSectionProps): React.JSX.Element {
  const activeVendor = form.activeVendor
  const activeStatus = credentialStatuses?.[activeVendor] ?? null
  const hasLlmAccess = activeStatus?.hasKey === true
  const selectorMode: 'preset' | 'freetext' =
    activeStatus?.source === 'managed' ? 'preset' : 'freetext'
  const vendorDefaults = getVendorDefaults(activeVendor)
  const videoSupported = vendorDefaults.semanticVideoModel.length > 0
  const visibleVendors = isEnterprise ? VENDORS : VENDORS.filter((v) => v !== 'google')
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
            <p className="text-xs text-muted-foreground">
              Each vendor remembers its own model selections.
            </p>
          </div>

          {activeStatus && (
            <ManageKeySection
              key={activeVendor}
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
                        presets={VENDOR_PRESETS[activeVendor].semanticVideo}
                        value={form.semanticVideoModel}
                        defaultValue={vendorDefaults.semanticVideoModel}
                        onChange={(v) => onModelChange('semanticVideoModel', v)}
                        label="Video analysis model"
                      />
                    )}
                    {form.semanticPipelineMode !== 'video' && (
                      <ModelSelector
                        mode={selectorMode}
                        presets={VENDOR_PRESETS[activeVendor].semanticSnapshot}
                        value={form.semanticSnapshotModel}
                        defaultValue={vendorDefaults.semanticSnapshotModel}
                        onChange={(v) => onModelChange('semanticSnapshotModel', v)}
                        label="Snapshot analysis model"
                      />
                    )}
                    <ModelSelector
                      mode={selectorMode}
                      presets={VENDOR_PRESETS[activeVendor].patternDetection}
                      value={form.patternDetectionModel}
                      defaultValue={vendorDefaults.patternDetectionModel}
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
