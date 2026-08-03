import { Label } from '@components/ui/label'

interface SettingsRowProps {
  label: React.ReactNode
  /** Rendered beside the label — a HelpTooltip, as in the blocklist section. */
  help?: React.ReactNode
  description?: React.ReactNode
  control: React.ReactNode
  layout?: 'inline' | 'stacked'
  labelHtmlFor?: string
}

export function SettingsRow({
  label,
  help,
  description,
  control,
  layout = 'inline',
  labelHtmlFor,
}: SettingsRowProps): React.JSX.Element {
  const labelNode = (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={labelHtmlFor} className="text-sm font-medium text-foreground">
        {label}
      </Label>
      {help}
    </div>
  )

  if (layout === 'stacked') {
    return (
      <div className="py-3 space-y-2 first:pt-0 last:pb-0">
        <div className="space-y-0.5">
          {labelNode}
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <div>{control}</div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="space-y-0.5 min-w-0">
        {labelNode}
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}
