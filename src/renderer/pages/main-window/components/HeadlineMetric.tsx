interface HeadlineMetricProps {
  totalHoursPerWeek: number | null
}

export function HeadlineMetric({
  totalHoursPerWeek,
}: HeadlineMetricProps): React.JSX.Element | null {
  if (totalHoursPerWeek === null || totalHoursPerWeek === 0) return null

  const display =
    totalHoursPerWeek < 1
      ? `~${Math.round(totalHoursPerWeek * 60)} min/week`
      : `~${totalHoursPerWeek} hours/week`

  return (
    <div className="rounded-lg bg-primary/10 px-4 py-3 text-center">
      <p className="text-lg font-semibold text-primary">
        MemoryLane found {display} of repetitive work
      </p>
    </div>
  )
}
