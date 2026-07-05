import { cn } from '@/renderer/lib/utils'
import type { RecurrenceBucket, RecurrenceUnit } from '@types'

interface RecurrenceBarsProps {
  /** Recurrence buckets, oldest→newest. */
  buckets: RecurrenceBucket[]
  unit: RecurrenceUnit
  className?: string
}

function formatBucket(start: number, unit: RecurrenceUnit): string {
  const label = new Date(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return unit === 'week' ? `Week of ${label}` : label
}

function axisStartLabel(start: number, unit: RecurrenceUnit): string {
  return new Date(start)
    .toLocaleDateString(
      undefined,
      unit === 'week' ? { month: 'short' } : { month: 'short', day: 'numeric' },
    )
    .toUpperCase()
}

/**
 * Vertical bar chart of recurrence over time. Each bar is a day or week
 * (per `unit`) and carries a date tooltip so you can see when sightings landed.
 */
export function RecurrenceBars({
  buckets,
  unit,
  className,
}: RecurrenceBarsProps): React.JSX.Element {
  const max = Math.max(...buckets.map((b) => b.count), 1)
  return (
    <div className={className}>
      <div className="flex items-end gap-0.5 h-20">
        {buckets.length === 0 ? (
          <div className="text-xs text-muted-foreground self-center">No recurrence data yet.</div>
        ) : (
          buckets.map((b) => (
            <div
              key={b.start}
              className={cn(
                'flex-1 min-w-[2px] rounded-sm',
                b.count === 0 ? 'bg-muted' : 'bg-primary/70',
              )}
              style={{ height: `${b.count === 0 ? 6 : Math.max(14, (b.count / max) * 100)}%` }}
              title={`${formatBucket(b.start, unit)} — ${b.count} sighting${b.count === 1 ? '' : 's'}`}
            />
          ))
        )}
      </div>
      {buckets.length > 0 && (
        <div className="flex justify-between mt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          <span>{axisStartLabel(buckets[0].start, unit)}</span>
          <span>NOW</span>
        </div>
      )}
    </div>
  )
}
