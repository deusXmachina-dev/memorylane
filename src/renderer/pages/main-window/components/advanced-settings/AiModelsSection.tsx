import { Button } from '@components/ui/button'
import type {
  CaptureSettings,
  CustomEndpointStatus,
  KeyStatus,
  MainWindowAPI,
  SemanticPipelineMode,
} from '@types'
import { CustomEndpointSection } from '../CustomEndpointSection'
import { ManageKeySection } from '../ManageKeySection'
import { SectionToggle } from './SectionToggle'
import { SliderRow } from './SliderRow'
import { ModelSelector } from './ModelSelector'
import type { ModelPreset } from './ModelSelector'
import type { NumericCaptureSetting } from './types'
import { formatMinSec } from './utils'

const VIDEO_PRESETS: ModelPreset[] = [
  { id: 'google/gemini-2.5-flash-lite-preview-09-2025', label: 'Gemini Flash Lite' },
  { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  { id: 'allenai/molmo-2-8b', label: 'Molmo 2 8B' },
]

const SNAPSHOT_PRESETS: ModelPreset[] = [
  { id: 'mistralai/mistral-small-3.2-24b-instruct', label: 'Mistral Small 3.2' },
  { id: 'google/gemini-2.5-flash-lite', label: 'Gemini Flash Lite' },
]

const PATTERN_PRESETS: ModelPreset[] = [{ id: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5' }]

const DEFAULT_VIDEO_MODEL = 'google/gemini-2.5-flash-lite-preview-09-2025'
const DEFAULT_SNAPSHOT_MODEL = 'mistralai/mistral-small-3.2-24b-instruct'
const DEFAULT_PATTERN_MODEL = 'moonshotai/kimi-k2.5'

interface AiModelsSectionProps {
  api: MainWindowAPI
  open: boolean
  onToggle: () => void
  form: CaptureSettings
  keyStatus: KeyStatus | null
  endpointStatus: CustomEndpointStatus | null
  onKeyStatusChanged: () => void
  onEndpointStatusChanged: () => void
  onSemanticPipelineModeChange: (mode: SemanticPipelineMode) => void
  onSettingChange: (key: NumericCaptureSetting, value: number) => void
  onSettingCommit: (key: NumericCaptureSetting, value: number) => void
  onModelChange: (
    key: 'semanticVideoModel' | 'semanticSnapshotModel' | 'patternDetectionModel',
    value: string,
  ) => void
}

export function AiModelsSection({
  api,
  open,
  onToggle,
  form,
  keyStatus,
  endpointStatus,
  onKeyStatusChanged,
  onEndpointStatusChanged,
  onSemanticPipelineModeChange,
  onSettingChange,
  onSettingCommit,
  onModelChange,
}: AiModelsSectionProps): React.JSX.Element {
  const isCustomEndpoint = endpointStatus?.enabled === true
  const selectorMode: 'preset' | 'freetext' =
    keyStatus?.source === 'managed' ? 'preset' : 'freetext'

  return (
    <section>
      <SectionToggle label="AI Models" open={open} onToggle={onToggle} />
      {open && (
        <div className="mt-3 space-y-5">
          {keyStatus && !isCustomEndpoint && (
            <ManageKeySection
              api={api}
              keyStatus={keyStatus}
              onKeyDeleted={onKeyStatusChanged}
              onKeyUpdated={onKeyStatusChanged}
            />
          )}
          {endpointStatus && (
            <>
              {keyStatus && !isCustomEndpoint && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="flex-1 h-px bg-border" />
                  <span>or</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}
              <CustomEndpointSection
                api={api}
                endpointStatus={endpointStatus}
                onEndpointChanged={onEndpointStatusChanged}
              />
            </>
          )}

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

          {!isCustomEndpoint && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">Model Selection</p>
              <ModelSelector
                mode={selectorMode}
                presets={VIDEO_PRESETS}
                value={form.semanticVideoModel}
                defaultValue={DEFAULT_VIDEO_MODEL}
                onChange={(v) => onModelChange('semanticVideoModel', v)}
                label="Video analysis model"
              />
              <ModelSelector
                mode={selectorMode}
                presets={SNAPSHOT_PRESETS}
                value={form.semanticSnapshotModel}
                defaultValue={DEFAULT_SNAPSHOT_MODEL}
                onChange={(v) => onModelChange('semanticSnapshotModel', v)}
                label="Snapshot analysis model"
              />
              <ModelSelector
                mode={selectorMode}
                presets={PATTERN_PRESETS}
                value={form.patternDetectionModel}
                defaultValue={DEFAULT_PATTERN_MODEL}
                onChange={(v) => onModelChange('patternDetectionModel', v)}
                label="Task mining model"
              />
            </div>
          )}
        </div>
      )}
    </section>
  )
}
