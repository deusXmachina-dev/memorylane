import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'

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
  if (mode === 'preset') {
    const effectiveValue = value || defaultValue
    return (
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <Button
              key={preset.id}
              variant={effectiveValue === preset.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => onChange(preset.id === defaultValue ? '' : preset.id)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="text"
        value={value || defaultValue}
        onChange={(e) => {
          const v = e.target.value
          onChange(v === defaultValue ? '' : v)
        }}
        placeholder={defaultValue}
        className="font-mono text-xs"
      />
    </div>
  )
}
