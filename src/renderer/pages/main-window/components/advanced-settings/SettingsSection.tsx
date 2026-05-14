interface SettingsSectionProps {
  title: string
  icon?: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
}

export function SettingsSection({
  title,
  icon,
  description,
  children,
}: SettingsSectionProps): React.JSX.Element {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      <div className="divide-y divide-border">{children}</div>
    </section>
  )
}
