import { useState } from 'react'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'

interface ModelSelectorProps {
  value: string
  defaultValue: string
  onChange: (model: string) => void
  label: string
}

export function ModelSelector({
  value,
  defaultValue,
  onChange,
  label,
}: ModelSelectorProps): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)

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
