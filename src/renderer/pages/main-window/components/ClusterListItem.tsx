import type { ClusterInfo } from '@types'
import { Sparkline } from './Sparkline'

interface ClusterListItemProps {
  cluster: ClusterInfo
  selected: boolean
  onSelect: () => void
}

function formatAvg(min: number): string {
  if (min >= 60) return `avg ${(min / 60).toFixed(1)}h`
  return `avg ${Math.max(1, Math.round(min))}m`
}

export function formatFrequency(perWeek: number): string {
  if (perWeek <= 0) return ''
  if (perWeek >= 0.95) return `~${Math.round(perWeek)}×/wk`
  const perMonth = perWeek * (30.44 / 7)
  return perMonth >= 0.95 ? `~${Math.round(perMonth)}×/mo` : '<1×/mo'
}

function formatRelative(timestamp: number | null): string {
  if (timestamp === null) return 'never'
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${Math.max(0, minutes)} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
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
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold leading-snug line-clamp-2">{cluster.title}</div>
        <span className="shrink-0 rounded-full border border-primary/40 px-2 py-0.5 text-[11px] font-medium tabular-nums text-primary">
          ×{cluster.timesSeen}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Sparkline
          values={cluster.recurrence.map((b) => b.count)}
          className="text-muted-foreground/60 shrink-0"
        />
        {formatFrequency(cluster.timesPerWeek) && (
          <>
            <span className="tabular-nums">{formatFrequency(cluster.timesPerWeek)}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <span className="tabular-nums">{formatAvg(cluster.avgSpanMin)}</span>
        <span aria-hidden>·</span>
        <span>{formatRelative(cluster.lastSeenAt)}</span>
      </div>
    </button>
  )
}
