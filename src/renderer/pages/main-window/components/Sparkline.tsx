import { cn } from '@/renderer/lib/utils'

interface SparklineProps {
  /** Per-bucket values, oldest→newest. */
  values: number[]
  className?: string
  width?: number
  height?: number
}

/** A tiny inline line chart (uses currentColor) for recurrence-over-time. */
export function Sparkline({
  values,
  className,
  width = 60,
  height = 16,
}: SparklineProps): React.JSX.Element {
  if (values.length === 0) {
    return <svg width={width} height={height} className={className} aria-hidden />
  }
  const max = Math.max(...values, 1)
  const n = values.length
  const points = values
    .map((v, i) => {
      const x = n > 1 ? (i / (n - 1)) * width : width / 2
      const y = height - 1 - (v / max) * (height - 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('overflow-visible', className)}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
