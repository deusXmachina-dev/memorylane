import type { PatternInfo } from '@types'

interface PatternListItemProps {
  pattern: PatternInfo
  selected: boolean
  onSelect: () => void
}

function formatLeadNumber(hoursPerWeek: number | null): { value: string; unit: string } {
  if (hoursPerWeek === null) return { value: '—', unit: 'recurring' }
  if (hoursPerWeek >= 1) return { value: `~${hoursPerWeek.toFixed(1)}`, unit: 'h/wk' }
  const minutes = Math.max(1, Math.round(hoursPerWeek * 60))
  return { value: `~${minutes}`, unit: 'min/wk' }
}

function formatRelative(timestamp: number | null): string {
  if (timestamp === null) return 'never'
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function PatternListItem({
  pattern,
  selected,
  onSelect,
}: PatternListItemProps): React.JSX.Element {
  const lead = formatLeadNumber(pattern.estimatedHoursPerWeek)
  const confidencePct =
    pattern.lastConfidence !== null ? Math.round(pattern.lastConfidence * 100) : null

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-md px-3 py-2.5 transition-colors border ${
        selected
          ? 'bg-primary/10 border-primary/40'
          : 'bg-card hover:bg-secondary/50 border-transparent'
      } ${pattern.completedAt ? 'opacity-60' : ''}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1 shrink-0">
          <span className="text-lg font-semibold tabular-nums">{lead.value}</span>
          <span className="text-[10px] text-muted-foreground">{lead.unit}</span>
        </div>
        <span className="text-[10px] text-muted-foreground truncate">
          {formatRelative(pattern.lastSeenAt)}
        </span>
      </div>
      <div className="mt-1 text-sm font-medium truncate">{pattern.name}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {pattern.sightingCount} sighting{pattern.sightingCount === 1 ? '' : 's'}
        {confidencePct !== null ? ` · ~${confidencePct}% conf` : ''}
      </div>
    </button>
  )
}
