const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const WEEK_LABELS = ['3W ago', '2W ago', 'last week', 'this week']

// Viewbox is stretched to full width (preserveAspectRatio="none"); the chart's
// rendered height is fixed by the `h-16` class so label offsets can be px.
const VB_W = 600
const VB_H = 60
const CHART_PX = 64 // h-16
const PAD_TOP = 32 // pt-8: headroom for the floating count labels

interface WeeklyTrendProps {
  /** Occurrence start timestamps (epoch ms), any order. */
  timestamps: number[]
  className?: string
}

/**
 * Occurrences per Monday–Sunday week over the last 4 weeks. The final bucket is
 * the current (partial) week. Older occurrences fall outside and are ignored.
 */
function weeklyCounts(timestamps: number[], now: number): number[] {
  const d = new Date(now)
  const mondayOffset = (d.getDay() + 6) % 7 // 0 = Monday
  const mondayThisWeek = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() - mondayOffset,
  ).getTime()
  const start = mondayThisWeek - 3 * WEEK_MS
  const counts = [0, 0, 0, 0]
  for (const t of timestamps) {
    if (t < start) continue
    const idx = Math.floor((t - start) / WEEK_MS)
    if (idx >= 0 && idx < 4) counts[idx] += 1
  }
  return counts
}

/** Catmull-Rom smoothed path through the points (nice rounded line, not jagged). */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  let d = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)} `
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? points[i + 1]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += `C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)} `
  }
  return d.trim()
}

/**
 * A small last-4-weeks area chart: how many times the task ran each week, with
 * the count floating above each point (following the curve) and faded week labels.
 */
export function WeeklyTrend({ timestamps, className }: WeeklyTrendProps): React.JSX.Element {
  const counts = weeklyCounts(timestamps, Date.now())
  const max = Math.max(...counts, 1)
  const points = counts.map((v, i) => ({
    x: (i / (counts.length - 1)) * VB_W,
    y: VB_H - 4 - (v / max) * (VB_H - 12),
  }))
  const line = smoothPath(points)
  const area = `${line} L ${VB_W},${VB_H} L 0,${VB_H} Z`

  return (
    <div className={className}>
      <div className="relative pt-8">
        {counts.map((v, i) =>
          v > 0 ? (
            <span
              key={i}
              className="absolute text-[11px] font-semibold tabular-nums text-primary"
              style={{
                top: PAD_TOP + (points[i].y / VB_H) * CHART_PX - 30,
                left:
                  i === 0
                    ? 0
                    : i === counts.length - 1
                      ? undefined
                      : `${(i / (counts.length - 1)) * 100}%`,
                right: i === counts.length - 1 ? 0 : undefined,
                transform: i > 0 && i < counts.length - 1 ? 'translateX(-50%)' : undefined,
              }}
            >
              {v}×
            </span>
          ) : null,
        )}
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          className="h-16 w-full overflow-visible text-primary"
          aria-hidden
        >
          <path d={area} fill="currentColor" fillOpacity={0.14} />
          <path
            d={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wide text-muted-foreground/50">
        {WEEK_LABELS.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </div>
  )
}
