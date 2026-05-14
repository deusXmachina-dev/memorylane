import { useState } from 'react'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import { SegmentedControl } from './SegmentedControl'

export interface ModelPreset {
  id: string
  label: string
}

interface ModelSelectorProps {
  mode: 'preset' | 'freetext'
  presets: ModelPreset[]
  value: string
  defaultValue: string
  onChange: (model: string) => void
  label: string
}

export function ModelSelector({
  mode,
  presets,
  value,
  defaultValue,
  onChange,
  label,
}: ModelSelectorProps): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)

  if (mode === 'preset') {
    const effectiveValue = value || defaultValue
    return (
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <SegmentedControl
          ariaLabel={label}
          layout="wrap"
          value={effectiveValue}
          onChange={(id) => onChange(id === defaultValue ? '' : id)}
          options={presets.map((preset) => ({ value: preset.id, label: preset.label }))}
        />
      </div>
    )
  }

  const displayed = draft ?? (value || defaultValue)

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="text"
        value={displayed}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null) {
            onChange(draft === defaultValue ? '' : draft)
            setDraft(null)
          }
        }}
        placeholder={defaultValue}
        className="font-mono text-xs"
      />
    </div>
  )
}
