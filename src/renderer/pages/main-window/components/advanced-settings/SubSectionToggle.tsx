interface SubSectionToggleProps {
  label: string
  open: boolean
  onToggle: () => void
}

export function SubSectionToggle({
  label,
  open,
  onToggle,
}: SubSectionToggleProps): React.JSX.Element {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      onClick={onToggle}
    >
      <span className="text-[9px]">{open ? '\u25BC' : '\u25B6'}</span>
      {label}
    </button>
  )
}
