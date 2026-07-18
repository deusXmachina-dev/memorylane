import type { ClusterInfo } from '@types'
import { formatMinutes, formatMonthlyHours } from './activities/format'
import { Sparkline } from './Sparkline'

interface ClusterListItemProps {
  cluster: ClusterInfo
  selected: boolean
  onSelect: () => void
}

export function ClusterListItem({
  cluster,
  selected,
  onSelect,
}: ClusterListItemProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-md px-3 py-2.5 transition-colors border ${
        selected
          ? 'bg-primary/10 border-primary/40'
          : 'bg-card hover:bg-secondary/50 border-transparent'
      }`}
    >
      <div className="text-sm font-semibold leading-snug line-clamp-2">{cluster.title}</div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Sparkline
          values={cluster.recurrence.map((b) => b.count)}
          className="text-muted-foreground/60 shrink-0"
        />
        <span className="tabular-nums">{cluster.timesSeen}×</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{formatMinutes(cluster.avgActiveMin)}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">
          {formatMonthlyHours(cluster.avgActiveMin * cluster.timesPerWeek * (30.44 / 7))}/mo
        </span>
      </div>
    </button>
  )
}
